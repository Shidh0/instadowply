using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Numerics;
using System.Text;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace InstaDowplyWin
{
    public partial class MainWindow : Window
    {
        private string reelsFolder;
        private string savedFolder;
        private string startCmdPath;
        private string likesJsonPath;
        
        private List<FileInfo> videoFiles = new List<FileInfo>();
        private int currentIndex = 0;
        
        private DispatcherTimer progressTimer;
        private DispatcherTimer clickTimer;
        private bool isDraggingScrubber = false;
        private bool isPlaying = true;
        private int clickCount = 0;

        // Scroll Debounce to lock 1 Reel per scroll gesture
        private DateTime lastScrollTime = DateTime.MinValue;

        public MainWindow()
        {
            InitializeComponent();
            
            string userHome = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            reelsFolder = Path.Combine(userHome, "insta-bulk-grabber", ".reels");
            savedFolder = Path.Combine(userHome, "Downloads", "InstaSaved");
            startCmdPath = Path.Combine(userHome, "insta-bulk-grabber", "start.cmd");
            likesJsonPath = Path.Combine(reelsFolder, "pending_likes.json");

            Directory.CreateDirectory(reelsFolder);
            Directory.CreateDirectory(savedFolder);

            progressTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(30) };
            progressTimer.Tick += ProgressTimer_Tick;

            clickTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(250) };
            clickTimer.Tick += ClickTimer_Tick;

            LoadVideoDirectory();
        }

        private void LoadVideoDirectory()
        {
            if (Directory.Exists(reelsFolder))
            {
                var dir = new DirectoryInfo(reelsFolder);
                videoFiles = dir.GetFiles("*.mp4")
                                .OrderBy(f => f.Name)
                                .ToList();
            }

            if (videoFiles.Count > 0)
            {
                currentIndex = Math.Max(0, Math.Min(currentIndex, videoFiles.Count - 1));
                PlayCurrentVideo(slideUp: true);
            }
            else
            {
                TxtCounter.Text = "0 / 0";
                TxtCaption.Text = "No reels found in:\n" + reelsFolder;
            }
        }

        private void PlayCurrentVideo(bool slideUp)
        {
            if (videoFiles.Count == 0) return;

            FileInfo currentFile = videoFiles[currentIndex];
            
            // Smooth vertical reel slide animation
            double startY = slideUp ? 260 : -260;
            VideoTransform.Y = startY;
            
            DoubleAnimation slideAnim = new DoubleAnimation(startY, 0, TimeSpan.FromMilliseconds(240))
            {
                EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut }
            };
            VideoTransform.BeginAnimation(TranslateTransform.YProperty, slideAnim);

            VideoPlayer.Source = new Uri(currentFile.FullName);
            VideoPlayer.Play();
            isPlaying = true;
            progressTimer.Start();

            TxtCounter.Text = $"{currentIndex + 1} / {videoFiles.Count}";
            FeedProgressBar.Value = ((double)(currentIndex + 1) / videoFiles.Count) * 100;

            LoadMetadata(currentFile);
            UpdateLikeAndSaveStatus(currentFile);
        }

        private void LoadMetadata(FileInfo videoFile)
        {
            string baseName = Path.GetFileNameWithoutExtension(videoFile.Name);
            string jsonPath = Path.Combine(reelsFolder, $"{baseName}_metadata.json");
            string pfpPath = Path.Combine(reelsFolder, $"{baseName}.jpg");

            TxtCaption.Text = "";
            TxtUsername.Text = "@user";
            TxtViews.Text = "";
            TxtLikeCount.Text = "";
            TxtAudioTrack.Text = "";
            TxtVerified.Visibility = Visibility.Collapsed;
            ImgPfp.Fill = new SolidColorBrush(Color.FromRgb(40, 40, 45));
            ImgAudioArt.Source = null;

            if (File.Exists(pfpPath))
            {
                ImgPfp.Fill = new ImageBrush(new BitmapImage(new Uri(pfpPath)));
            }

            if (File.Exists(jsonPath))
            {
                try
                {
                    string jsonText = File.ReadAllText(jsonPath);
                    JObject json = JObject.Parse(jsonText);

                    var userObj = json["user"];
                    if (userObj != null)
                    {
                        TxtUsername.Text = "@" + (userObj["username"]?.ToString() ?? "user");
                        if (userObj["is_verified"]?.ToObject<bool>() == true)
                        {
                            TxtVerified.Visibility = Visibility.Visible;
                        }
                    }

                    var captionObj = json["caption"];
                    if (captionObj != null)
                    {
                        TxtCaption.Text = captionObj["text"]?.ToString() ?? "";
                    }

                    int likes = json["like_count"]?.ToObject<int>() ?? -1;
                    if (likes >= 0) TxtLikeCount.Text = FormatMetric(likes);

                    int views = json["play_count"]?.ToObject<int>() ?? json["view_count"]?.ToObject<int>() ?? -1;
                    if (views >= 0) TxtViews.Text = $"{FormatMetric(views)} views";

                    var clipsMeta = json["clips_metadata"];
                    var musicInfo = clipsMeta?["music_info"]?["music_asset_info"];
                    if (musicInfo != null)
                    {
                        string title = musicInfo["title"]?.ToString() ?? "";
                        string artist = musicInfo["display_artist"]?.ToString() ?? "";
                        TxtAudioTrack.Text = $"{title} • {artist}";
                    }
                }
                catch { }
            }
        }

        private void UpdateLikeAndSaveStatus(FileInfo videoFile)
        {
            string reelId = GetReelId(videoFile.Name);

            bool isLiked = false;
            if (File.Exists(likesJsonPath))
            {
                try
                {
                    string content = File.ReadAllText(likesJsonPath);
                    isLiked = content.Contains($"\"{reelId}\"");
                }
                catch { }
            }

            HeartIconPath.Fill = isLiked ? new SolidColorBrush((Color)ColorConverter.ConvertFromString("#FF007F")) : Brushes.Transparent;
            HeartIconPath.Stroke = isLiked ? new SolidColorBrush((Color)ColorConverter.ConvertFromString("#FF007F")) : Brushes.White;

            string targetSaved = Path.Combine(savedFolder, videoFile.Name);
            SaveIconPath.Fill = File.Exists(targetSaved) ? Brushes.White : Brushes.Transparent;
        }

        // ================= NAVIGATION & CONTROLS =================

        private void Window_MouseWheel(object sender, MouseWheelEventArgs e)
        {
            // Debounce scrolling: Enforce minimum 350ms lock between reel swipes
            if ((DateTime.Now - lastScrollTime).TotalMilliseconds < 350) return;
            lastScrollTime = DateTime.Now;

            if (e.Delta < 0) NextVideo();
            else if (e.Delta > 0) PreviousVideo();
        }

        private void Window_PreviewKeyDown(object sender, KeyEventArgs e)
        {
            if (e.Key == Key.Down || e.Key == Key.PageDown) NextVideo();
            else if (e.Key == Key.Up || e.Key == Key.PageUp) PreviousVideo();
            else if (e.Key == Key.Space) TogglePlayPause();
            else if (e.Key == Key.F11) ToggleFullscreen();
        }

        private void ToggleFullscreen()
        {
            if (WindowStyle == WindowStyle.None)
            {
                WindowStyle = WindowStyle.SingleBorderWindow;
                WindowState = WindowState.Normal;
            }
            else
            {
                WindowStyle = WindowStyle.None;
                WindowState = WindowState.Maximized;
            }
        }

        private void NextVideo()
        {
            if (currentIndex < videoFiles.Count - 1)
            {
                currentIndex++;
                PlayCurrentVideo(slideUp: true);
            }
        }

        private void PreviousVideo()
        {
            if (currentIndex > 0)
            {
                currentIndex--;
                PlayCurrentVideo(slideUp: false);
            }
        }

        private void TogglePlayPause()
        {
            if (isPlaying)
            {
                VideoPlayer.Pause();
                isPlaying = false;
            }
            else
            {
                VideoPlayer.Play();
                isPlaying = true;
            }
        }

        private void VideoPlayer_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
        {
            clickCount++;
            if (clickCount == 1)
            {
                clickTimer.Start();
            }
            else if (clickCount == 2)
            {
                clickTimer.Stop();
                clickCount = 0;
                TriggerHeartAnimation();
                ForceLikeCurrentVideo();
            }
        }

        private void ClickTimer_Tick(object sender, EventArgs e)
        {
            clickTimer.Stop();
            clickCount = 0;
            TogglePlayPause();
        }

        private async void TriggerHeartAnimation()
        {
            HeartOverlay.Visibility = Visibility.Visible;
            await Task.Delay(400);
            HeartOverlay.Visibility = Visibility.Collapsed;
        }

        private void VideoPlayer_MediaEnded(object sender, RoutedEventArgs e)
        {
            VideoPlayer.Position = TimeSpan.Zero;
            VideoPlayer.Play();
        }

        private void ProgressTimer_Tick(object sender, EventArgs e)
        {
            if (!isDraggingScrubber && VideoPlayer.NaturalDuration.HasTimeSpan)
            {
                VideoScrubber.Value = VideoPlayer.Position.TotalSeconds / VideoPlayer.NaturalDuration.TimeSpan.TotalSeconds;
            }
        }

        // ISOLATED SLIDER EVENTS (e.Handled = true stops video play/pause toggle bug)
        private void VideoScrubber_PreviewMouseLeftButtonDown(object sender, MouseButtonEventArgs e)
        {
            e.Handled = true;
            isDraggingScrubber = true;
        }

        private void VideoScrubber_PreviewMouseLeftButtonUp(object sender, MouseButtonEventArgs e)
        {
            e.Handled = true;
            isDraggingScrubber = false;
            SeekToScrubberPosition();
        }

        private void VideoScrubber_ValueChanged(object sender, RoutedPropertyChangedEventArgs<double> e)
        {
            if (isDraggingScrubber) SeekToScrubberPosition();
        }

        private void SeekToScrubberPosition()
        {
            if (VideoPlayer.NaturalDuration.HasTimeSpan)
            {
                double targetSecs = VideoScrubber.Value * VideoPlayer.NaturalDuration.TimeSpan.TotalSeconds;
                VideoPlayer.Position = TimeSpan.FromSeconds(targetSecs);
            }
        }

        // ================= ACTION BUTTONS =================

        private void BtnLike_Click(object sender, RoutedEventArgs e)
        {
            if (videoFiles.Count == 0) return;
            ToggleLike(GetReelId(videoFiles[currentIndex].Name));
        }

        private void ForceLikeCurrentVideo()
        {
            if (videoFiles.Count == 0) return;
            ToggleLike(GetReelId(videoFiles[currentIndex].Name), forceAdd: true);
        }

        private void ToggleLike(string reelId, bool forceAdd = false)
        {
            List<string> ids = new List<string>();
            if (File.Exists(likesJsonPath))
            {
                try
                {
                    string raw = File.ReadAllText(likesJsonPath);
                    ids = JsonConvert.DeserializeObject<List<string>>(raw) ?? new List<string>();
                }
                catch { }
            }

            if (ids.Contains(reelId) && !forceAdd) ids.Remove(reelId);
            else if (!ids.Contains(reelId)) ids.Add(reelId);

            File.WriteAllText(likesJsonPath, JsonConvert.SerializeObject(ids));
            UpdateLikeAndSaveStatus(videoFiles[currentIndex]);
        }

        private void BtnSave_Click(object sender, RoutedEventArgs e)
        {
            if (videoFiles.Count == 0) return;
            FileInfo file = videoFiles[currentIndex];
            string dest = Path.Combine(savedFolder, file.Name);

            if (File.Exists(dest)) File.Delete(dest);
            else File.Copy(file.FullName, dest, overwrite: true);

            UpdateLikeAndSaveStatus(file);
        }

        private void BtnStartEngine_Click(object sender, RoutedEventArgs e)
        {
            if (File.Exists(startCmdPath))
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = startCmdPath,
                    WorkingDirectory = Path.GetDirectoryName(startCmdPath),
                    UseShellExecute = true
                });
            }
            else
            {
                MessageBox.Show($"Script file not found:\n{startCmdPath}", "Instadowply", MessageBoxButton.OK, MessageBoxImage.Warning);
            }
        }

        private void BtnOpenWeb_Click(object sender, RoutedEventArgs e)
        {
            if (videoFiles.Count == 0) return;
            string reelId = GetReelId(videoFiles[currentIndex].Name);
            string shortcode = ConvertNumericIdToShortcode(reelId);
            if (!string.IsNullOrEmpty(shortcode))
                Process.Start(new ProcessStartInfo($"https://www.instagram.com/reel/{shortcode}/") { UseShellExecute = true });
        }

        private void BtnShare_Click(object sender, RoutedEventArgs e)
        {
            if (videoFiles.Count == 0) return;
            string reelId = GetReelId(videoFiles[currentIndex].Name);
            string shortcode = ConvertNumericIdToShortcode(reelId);
            if (!string.IsNullOrEmpty(shortcode))
            {
                Clipboard.SetText($"https://www.instagram.com/reel/{shortcode}/");
                MessageBox.Show("Reel link copied to clipboard!", "Instadowply", MessageBoxButton.OK, MessageBoxImage.Information);
            }
        }

        private void Profile_MouseDown(object sender, MouseButtonEventArgs e)
        {
            string handle = TxtUsername.Text.TrimStart('@');
            if (handle != "user" && !string.IsNullOrEmpty(handle))
                Process.Start(new ProcessStartInfo($"https://www.instagram.com/{handle}/") { UseShellExecute = true });
        }

        private void Caption_MouseDown(object sender, MouseButtonEventArgs e)
        {
            TxtCaption.MaxHeight = TxtCaption.MaxHeight == 36 ? 300 : 36;
        }

        private void Info_Click(object sender, RoutedEventArgs e)
        {
            MessageBox.Show($"Instadowply Desktop\n\nReels Path:\n{reelsFolder}\n\nSaved Path:\n{savedFolder}\n\nEngine Command:\n{startCmdPath}", "Instadowply Info");
        }

        private void Refresh_Click(object sender, RoutedEventArgs e) => LoadVideoDirectory();
private void Window_StateChanged(object sender, EventArgs e)
{
    if (WindowState == WindowState.Maximized)
    {
        WindowStyle = WindowStyle.None;
    }
    else
    {
        WindowStyle = WindowStyle.SingleBorderWindow;
    }
}

        // ================= UTILITIES =================

        private string GetReelId(string fileName)
        {
            string name = Path.GetFileNameWithoutExtension(fileName);
            return name.Contains("reel_") ? name.Substring(name.IndexOf("reel_") + 5) : name;
        }

        private string ConvertNumericIdToShortcode(string numericId)
        {
            const string alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
            try {
                string cleanId = numericId.Split('_')[0].Trim();
                BigInteger id = BigInteger.Parse(cleanId);
                if (id == 0) return "";
                StringBuilder sb = new StringBuilder();
                while (id > 0) {
                    int rem = (int)(id % 64);
                    sb.Append(alphabet[rem]);
                    id /= 64;
                }
                char[] arr = sb.ToString().ToCharArray();
                Array.Reverse(arr);
                return new string(arr);
            } catch { return ""; }
        }

        private string FormatMetric(int count)
        {
            if (count >= 1000000) return (count / 1000000f).ToString("0.#") + "M";
            if (count >= 1000) return (count / 1000f).ToString("0.#") + "k";
            return count.ToString();
        }
    }
}