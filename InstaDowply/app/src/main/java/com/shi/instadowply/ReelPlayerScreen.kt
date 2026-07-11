package com.shi.instadowply

import java.math.BigInteger
import androidx.compose.ui.draw.alpha
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.material.icons.filled.Settings
import android.graphics.BitmapFactory
import android.widget.Toast
import androidx.compose.animation.*
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.pager.VerticalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import java.io.File
import kotlinx.coroutines.delay

/**
 * Converts a raw Instagram numeric Media ID into its corresponding URL shortcode.
 */
fun convertNumericIdToShortcode(numericId: String): String {
    val alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
    val radix = BigInteger.valueOf(64)
    
    return try {
        // Strip any trailing user details if the ID format is "mediaID_userID"
        val cleanId = numericId.substringBefore("_").trim()
        var id = BigInteger(cleanId)
        
        if (id == BigInteger.ZERO) return ""
        
        val shortcodeBuilder = StringBuilder()
        while (id > BigInteger.ZERO) {
            val remainder = id.mod(radix).toInt()
            shortcodeBuilder.append(alphabet[remainder])
            id = id.divide(radix)
        }
        
        // Reverse the string since we calculated it from least to most significant bits
        shortcodeBuilder.reverse().toString()
    } catch (e: Exception) {
        "" // Fallback or log error if string isn't a valid numeric string
    }
}

fun formatMetricCount(count: Int): String {
    return when {
        count >= 1_000_000 -> String.format("%.1fM", count / 1_000_000f).replace(".0", "")
        count >= 1_000 -> String.format("%.1fk", count / 1_000f).replace(".0", "")
        else -> count.toString()
    }
}

@Composable
fun ReelPlayerScreen(
    videoDirectory: File,
    initialPage: Int,
    onPageChanged: (Int) -> Unit,
    onFeedFinished: (() -> Unit) -> Unit,
    onLaunchTermux: () -> Unit
) {
    val context = LocalContext.current
    var refreshTrigger by remember { mutableIntStateOf(0) }
    var isTermuxRunning by remember { mutableStateOf(false) }
    val prefs = remember { context.getSharedPreferences("instadowply_cache", Context.MODE_PRIVATE) }
    var useBackgroundIntent by remember { mutableStateOf(prefs.getBoolean("USE_BACKGROUND_INTENT", true)) }
    var showSettingsDialog by remember { mutableStateOf(false) }
    val lockFile = remember(videoDirectory) { File(videoDirectory, "download.lock") }
    LaunchedEffect(lockFile) {
        while (true) {
            isTermuxRunning = lockFile.exists()
            delay(1500)
        }
    }

    val videoFiles = remember(videoDirectory, refreshTrigger) {
        videoDirectory.listFiles()?.filter { it.isFile && it.extension == "mp4" }?.sortedBy { it.name } ?: emptyList()
    }

    val targetStartPage = if (initialPage < videoFiles.size && initialPage >= 0) initialPage else 0
    val pagerState = rememberPagerState(
        initialPage = targetStartPage,
        pageCount = { videoFiles.size }
    )
    
    LaunchedEffect(videoFiles.size) {
        if (videoFiles.isEmpty() && pagerState.currentPage != 0) {
            pagerState.scrollToPage(0)
        }
    }
    val playerPool = remember(context) {
        List(3) {
            ExoPlayer.Builder(context).build().apply {
                repeatMode = Player.REPEAT_MODE_ONE
                playWhenReady = false
            }
        }
    }
    var showDialog by remember { mutableStateOf(false) }

    val currentVideoFile = videoFiles.getOrNull(pagerState.currentPage)
    val currentReelId = remember(currentVideoFile) {
        currentVideoFile?.nameWithoutExtension?.substringAfter("reel_") ?: ""
    }

    var isCurrentVideoLiked by remember(currentReelId) { mutableStateOf(false) }
    var isCurrentVideoSaved by remember(currentVideoFile) { mutableStateOf(false) }
    val likesJsonFile = remember(videoDirectory) { File(videoDirectory, "pending_likes.json") }

    LaunchedEffect(currentReelId, currentVideoFile, refreshTrigger) {
        if (likesJsonFile.exists() && currentReelId.isNotEmpty()) {
            try {
                isCurrentVideoLiked = likesJsonFile.readText().contains("\"$currentReelId\"")
            } catch (e: Exception) {
                isCurrentVideoLiked = false
            }
        } else {
            isCurrentVideoLiked = false
        }

        isCurrentVideoSaved = if (currentVideoFile != null) {
            File("/sdcard/Download/InstaSaved", currentVideoFile.name).exists()
        } else {
            false
        }
    }

    val instagramHeartIcon = remember(isCurrentVideoLiked) {
        androidx.compose.ui.graphics.vector.ImageVector.Builder(
            name = "InstagramHeartIcon",
            defaultWidth = 24.dp,
            defaultHeight = 24.dp,
            viewportWidth = 24f,
            viewportHeight = 24f
        ).path(
            fill = if (isCurrentVideoLiked) androidx.compose.ui.graphics.SolidColor(Color.Red) else null, 
            stroke = androidx.compose.ui.graphics.SolidColor(if (isCurrentVideoLiked) Color.Red else Color.White),
            strokeLineWidth = 2f,
            strokeLineCap = androidx.compose.ui.graphics.StrokeCap.Round,
            strokeLineJoin = androidx.compose.ui.graphics.StrokeJoin.Round
        ) {
            moveTo(12f, 21.35f)
            lineTo(10.55f, 20.03f)
            curveTo(5.4f, 15.36f, 2f, 12.28f, 2f, 8.5f)
            curveTo(2f, 5.42f, 4.42f, 3f, 7.5f, 3f)
            curveTo(9.24f, 3f, 10.91f, 3.81f, 12f, 5.09f)
            curveTo(13.09f, 3.81f, 14.76f, 3f, 16.5f, 3f)
            curveTo(19.58f, 3f, 22f, 5.42f, 22f, 8.5f)
            curveTo(22f, 12.28f, 18.6f, 15.36f, 13.45f, 20.04f)
            close()
        }.build()
    }

    val instagramSaveIcon = remember(isCurrentVideoSaved) {
        androidx.compose.ui.graphics.vector.ImageVector.Builder(
            name = "InstagramSaveIcon",
            defaultWidth = 24.dp,
            defaultHeight = 24.dp,
            viewportWidth = 24f,
            viewportHeight = 24f
        ).path(
            fill = if (isCurrentVideoSaved) androidx.compose.ui.graphics.SolidColor(Color.White) else null, 
            stroke = androidx.compose.ui.graphics.SolidColor(Color.White),
            strokeLineWidth = 2f,
            strokeLineCap = androidx.compose.ui.graphics.StrokeCap.Round,
            strokeLineJoin = androidx.compose.ui.graphics.StrokeJoin.Round
        ) {
            moveTo(5f, 3f)
            horizontalLineTo(19f)
            verticalLineTo(21f)
            lineTo(12f, 15f)
            lineTo(5f, 21f)
            close()
        }.build()
    }

    // NEW: Open Link App Action Vector Path Configuration
    val instagramAppIcon = remember {
        androidx.compose.ui.graphics.vector.ImageVector.Builder(
            name = "InstagramAppIcon",
            defaultWidth = 24.dp,
            defaultHeight = 24.dp,
            viewportWidth = 24f,
            viewportHeight = 24f
        ).path(
            stroke = androidx.compose.ui.graphics.SolidColor(Color.White),
            strokeLineWidth = 2f,
            strokeLineCap = androidx.compose.ui.graphics.StrokeCap.Round,
            strokeLineJoin = androidx.compose.ui.graphics.StrokeJoin.Round
        ) {
            moveTo(7f, 2f)
            horizontalLineTo(17f)
            curveTo(19.76f, 2f, 22f, 4.24f, 22f, 7f)
            verticalLineTo(17f)
            curveTo(22f, 19.76f, 19.76f, 22f, 17f, 22f)
            horizontalLineTo(7f)
            curveTo(4.24f, 22f, 2f, 19.76f, 2f, 17f)
            verticalLineTo(7f)
            curveTo(2f, 4.24f, 4.24f, 2f, 7f, 2f)
            close()
            moveTo(12f, 7f)
            curveTo(9.24f, 7f, 7f, 9.24f, 7f, 12f)
            curveTo(7f, 14.76f, 9.24f, 17f, 12f, 17f)
            curveTo(14.76f, 17f, 17f, 14.76f, 17f, 12f)
            curveTo(17f, 9.24f, 14.76f, 7f, 12f, 7f)
            close()
        }.build()
    }

    // NEW: Native Share Action Paper Airplane Vector Path Configuration
    val instagramShareIcon = remember {
        androidx.compose.ui.graphics.vector.ImageVector.Builder(
            name = "InstagramShareIcon",
            defaultWidth = 24.dp,
            defaultHeight = 24.dp,
            viewportWidth = 24f,
            viewportHeight = 24f
        ).path(
            stroke = androidx.compose.ui.graphics.SolidColor(Color.White),
            strokeLineWidth = 2f,
            strokeLineCap = androidx.compose.ui.graphics.StrokeCap.Round,
            strokeLineJoin = androidx.compose.ui.graphics.StrokeJoin.Round
        ) {
            moveTo(22f, 2f)
            lineTo(11f, 13f)
            moveTo(22f, 2f)
            lineTo(15f, 22f)
            lineTo(11f, 13f)
            lineTo(2f, 9f)
            close()
        }.build()
    }

// UPDATED: Intent Handlers using the shortcode conversion engine
    val openInstagramAction = { reelId: String ->
        if (reelId.isNotEmpty()) {
            try {
                val shortcode = convertNumericIdToShortcode(reelId)
                val uri = Uri.parse("https://www.instagram.com/reel/$shortcode/")
                val intent = Intent(Intent.ACTION_VIEW, uri).apply {
                    setPackage("com.instagram.android")
                }
                try {
                    context.startActivity(intent)
                } catch (e: Exception) {
                    context.startActivity(Intent(Intent.ACTION_VIEW, uri))
                }
            } catch (e: Exception) {
                Toast.makeText(context, "Cannot launch path: ${e.message}", Toast.LENGTH_SHORT).show()
            }
        }
    }

    val shareReelAction = { reelId: String ->
        if (reelId.isNotEmpty()) {
            try {
                val shortcode = convertNumericIdToShortcode(reelId)
                val shareIntent = Intent(Intent.ACTION_SEND).apply {
                    type = "text/plain"
                    putExtra(Intent.EXTRA_TEXT, "https://www.instagram.com/reel/$shortcode/")
                }
                context.startActivity(Intent.createChooser(shareIntent, "Share Reel"))
            } catch (e: Exception) {
                Toast.makeText(context, "Share broken: ${e.message}", Toast.LENGTH_SHORT).show()
            }
        }
    }

    val openProfileAction = { username: String ->
        val handle = username.removePrefix("@")
        if (handle.isNotEmpty() && handle != "user") {
            try {
                val uri = Uri.parse("https://www.instagram.com/$handle/")
                val intent = Intent(Intent.ACTION_VIEW, uri).apply {
                    setPackage("com.instagram.android")
                }
                try {
                    context.startActivity(intent)
                } catch (e: Exception) {
                    context.startActivity(Intent(Intent.ACTION_VIEW, uri))
                }
            } catch (e: Exception) {
                Toast.makeText(context, "Cannot launch profile: ${e.message}", Toast.LENGTH_SHORT).show()
            }
        }
    }

    val toggleLikeAction = {
        if (currentReelId.isNotEmpty()) {
            try {
                val fileContent = if (likesJsonFile.exists()) likesJsonFile.readText().trim() else "[]"
                val cleanContent = fileContent.replace("[", "").replace("]", "").replace("\"", "")
                val idsList = cleanContent.split(",").map { it.trim() }.filter { it.isNotEmpty() }.toMutableList()

                if (idsList.contains(currentReelId)) {
                    idsList.remove(currentReelId)
                    isCurrentVideoLiked = false
                } else {
                    idsList.add(currentReelId)
                    isCurrentVideoLiked = true
                }

                val newJsonString = idsList.joinToString(separator = ",", prefix = "[", postfix = "]") { "\"$it\"" }
                likesJsonFile.writeText(newJsonString)
            } catch (e: Exception) {
                Toast.makeText(context, "Sync write error: ${e.message}", Toast.LENGTH_SHORT).show()
            }
        }
    }

    val forceLikeAction = {
        if (currentReelId.isNotEmpty()) {
            try {
                val fileContent = if (likesJsonFile.exists()) likesJsonFile.readText().trim() else "[]"
                val cleanContent = fileContent.replace("[", "").replace("]", "").replace("\"", "")
                val idsList = cleanContent.split(",").map { it.trim() }.filter { it.isNotEmpty() }.toMutableList()

                if (!idsList.contains(currentReelId)) {
                    idsList.add(currentReelId)
                    isCurrentVideoLiked = true
                    val newJsonString = idsList.joinToString(separator = ",", prefix = "[", postfix = "]") { "\"$it\"" }
                    likesJsonFile.writeText(newJsonString)
                }
            } catch (e: Exception) {
                Toast.makeText(context, "Sync write error: ${e.message}", Toast.LENGTH_SHORT).show()
            }
        }
    }

    val toggleSaveAction = { fileToSave: File ->
        try {
            val whitelistDir = File("/sdcard/Download/InstaSaved")
            if (!whitelistDir.exists()) {
                whitelistDir.mkdirs()
            }
            val destination = File(whitelistDir, fileToSave.name)
            if (destination.exists()) {
                destination.delete()
                isCurrentVideoSaved = false
                
                android.media.MediaScannerConnection.scanFile(
                    context,
                    arrayOf(destination.absolutePath),
                    arrayOf("video/mp4"),
                    null
                )
                
                Toast.makeText(context, "Removed from InstaSaved", Toast.LENGTH_SHORT).show()
            } else {
                if (fileToSave.exists()) {
                    fileToSave.copyTo(destination, overwrite = true)
                    isCurrentVideoSaved = true
                    Toast.makeText(context, "Copied to Download/InstaSaved ", Toast.LENGTH_SHORT).show()
                    
                    android.media.MediaScannerConnection.scanFile(
                        context,
                        arrayOf(destination.absolutePath),
                        arrayOf("video/mp4")
                    ) { _, _ ->
                    }
                }
            }
        } catch (e: Exception) {
            Toast.makeText(context, "Folder Save Error: ${e.message}", Toast.LENGTH_LONG).show()
        }
    }

    DisposableEffect(Unit) {
        onDispose {
            playerPool.forEach { it.release() }
        }
    }

    LaunchedEffect(pagerState.currentPage) {
        if (videoFiles.isNotEmpty()) {
            onPageChanged(pagerState.currentPage)
        }
    }

    Box(modifier = Modifier.fillMaxSize().background(Color.Black)) {
        if (videoFiles.isEmpty()) {
            Box(
                modifier = Modifier.fillMaxSize(),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = "No reels found.\nRun script via Termux!",
                    style = MaterialTheme.typography.bodyLarge,
                    color = Color.Gray
                )
            }
        } else {
            LaunchedEffect(pagerState.currentPage, videoFiles, refreshTrigger) {
                if (videoFiles.isNotEmpty()) {
                    val currentIdx = pagerState.currentPage
                    playerPool.forEach { it.pause() }

                    if (currentIdx < videoFiles.size) {
                        val currentPlayer = playerPool[currentIdx % 3]
                        val activeFile = videoFiles[currentIdx]
                        
                        if (currentPlayer.currentMediaItem?.localConfiguration?.uri?.path != activeFile.absolutePath) {
                            currentPlayer.setMediaItem(MediaItem.fromUri(activeFile.absolutePath))
                            currentPlayer.prepare()
                        }
                        currentPlayer.playWhenReady = true
                    }

                    val nextIdx = currentIdx + 1
                    if (nextIdx < videoFiles.size) {
                        val nextPlayer = playerPool[nextIdx % 3]
                        val nextFile = videoFiles[nextIdx]
                        
                        if (nextPlayer.currentMediaItem?.localConfiguration?.uri?.path != nextFile.absolutePath) {
                            nextPlayer.stop()
                            nextPlayer.clearMediaItems()
                            nextPlayer.setMediaItem(MediaItem.fromUri(nextFile.absolutePath))
                            nextPlayer.prepare()
                        }
                        nextPlayer.playWhenReady = false
                    }

                    val prevIdx = currentIdx - 1
                    if (prevIdx >= 0 && prevIdx < videoFiles.size) {
                        val prevPlayer = playerPool[prevIdx % 3]
                        val prevFile = videoFiles[prevIdx]
                        
                        if (prevPlayer.currentMediaItem?.localConfiguration?.uri?.path != prevFile.absolutePath) {
                            prevPlayer.stop()
                            prevPlayer.clearMediaItems()
                            prevPlayer.setMediaItem(MediaItem.fromUri(prevFile.absolutePath))
                            prevPlayer.prepare()
                        }
                        prevPlayer.playWhenReady = false
                    }
                }
            }

            VerticalPager(
                state = pagerState,
                modifier = Modifier.fillMaxSize()
            ) { page ->
                val loopVideoFile = videoFiles.getOrNull(page)
                
                val instagramMetadata = remember(loopVideoFile) {
                    if (loopVideoFile != null) {
                        val jsonFile = File(loopVideoFile.parentFile, "${loopVideoFile.nameWithoutExtension}_metadata.json")
                        if (jsonFile.exists()) {
                            try {
                                org.json.JSONObject(jsonFile.readText())
                            } catch (e: Exception) {
                                null
                            }
                        } else null
                    } else null
                }

                val loopCaptionText = remember(instagramMetadata) {
                    try {
                        instagramMetadata?.optJSONObject("caption")?.optString("text") ?: ""
                    } catch (e: Exception) {
                        ""
                    }
                }

                val loopUsernameText = remember(instagramMetadata) {
                    try {
                        instagramMetadata?.optJSONObject("user")?.optString("username") ?: "@user"
                    } catch (e: Exception) {
                        "@user"
                    }
                }

                val loopIsVerified = remember(instagramMetadata) {
                    try {
                        instagramMetadata?.optJSONObject("user")?.optBoolean("is_verified", false) ?: false
                    } catch (e: Exception) { false }
                }

                val loopLikeCountText = remember(instagramMetadata) {
                    try {
                        val likes = instagramMetadata?.optInt("like_count", -1) ?: -1
                        if (likes >= 0) formatMetricCount(likes) else ""
                    } catch (e: Exception) { "" }
                }

                val loopViewCountText = remember(instagramMetadata) {
                    try {
                        val views = instagramMetadata?.optInt("play_count", -1)?.takeIf { it >= 0 }
                            ?: instagramMetadata?.optInt("view_count", -1)?.takeIf { it >= 0 }
                            ?: instagramMetadata?.optJSONObject("clips_metadata")?.optInt("play_count", -1) ?: -1
                        
                        if (views >= 0) formatMetricCount(views) else ""
                    } catch (e: Exception) { "" }
                }

                val loopAudioTrackText = remember(instagramMetadata) {
                    try {
                        val clipsMetadata = instagramMetadata?.optJSONObject("clips_metadata")
                        val musicInfo = clipsMetadata?.optJSONObject("music_info")?.optJSONObject("music_asset_info")
                            ?: instagramMetadata?.optJSONObject("audio_info")
                        
                        if (musicInfo != null) {
                            val title = musicInfo.optString("title", "")
                            val artist = musicInfo.optString("display_artist", "") ?: musicInfo.optString("artist_name", "")
                            if (title.isNotEmpty()) "$title • $artist" else ""
                        } else {
                            val originalSoundInfo = clipsMetadata?.optJSONObject("original_sound_info")
                            if (originalSoundInfo != null) {
                                val title = originalSoundInfo.optString("original_audio_title", "Original audio")
                                val artist = originalSoundInfo.optJSONObject("ig_artist")?.optString("username", "") ?: ""
                                if (artist.isNotEmpty()) "$title • $artist" else title
                            } else ""
                        }
                    } catch (e: Exception) { "" }
                }

                val loopPfpBitmap = remember(loopVideoFile) {
                    if (loopVideoFile != null) {
                        val pfpFile = File(loopVideoFile.parentFile, "${loopVideoFile.nameWithoutExtension}.jpg")
                        if (pfpFile.exists()) {
                            try {
                                BitmapFactory.decodeFile(pfpFile.absolutePath)?.asImageBitmap()
                            } catch (e: Exception) { null }
                        } else null
                    } else null
                }

                val loopReelId = remember(loopVideoFile) {
                    loopVideoFile?.nameWithoutExtension?.substringAfter("reel_") ?: ""
                }

                val loopSongBitmap = remember(loopVideoFile, loopReelId) {
                    if (loopVideoFile != null) {
                        val parentDir = loopVideoFile.parentFile
                        val reelFolder = File(parentDir, ".reel")
                        val baseName = loopVideoFile.nameWithoutExtension

                        val candidateFiles = listOf(
                            File(reelFolder, "${baseName}_song.jpg"),  
                            File(parentDir, "${baseName}_song.jpg"),  
                            File(reelFolder, "${loopReelId}_song.jpg"), 
                            File(parentDir, "${loopReelId}_song.jpg")  
                        )

                        val matchedFile = candidateFiles.firstOrNull { it.exists() }
                        if (matchedFile != null) {
                            try {
                                BitmapFactory.decodeFile(matchedFile.absolutePath)?.asImageBitmap()
                            } catch (e: Exception) { null }
                        } else null
                    } else null
                }
                
                val isOriginalAudio = remember(instagramMetadata) {
    try {
        val clipsMetadata = instagramMetadata?.optJSONObject("clips_metadata")
        val hasMusicInfo = clipsMetadata?.optJSONObject("music_info")?.optJSONObject("music_asset_info") != null 
                || instagramMetadata?.optJSONObject("audio_info") != null
        val hasOriginalSound = clipsMetadata?.optJSONObject("original_sound_info") != null
        !hasMusicInfo && hasOriginalSound
    } catch (e: Exception) {
        false
    }
}

                Box(modifier = Modifier.fillMaxSize()) {
                    SharedPlayerItemSurface(
                        exoPlayer = playerPool[page % 3],
                        isCurrentPage = pagerState.currentPage == page,
                        onDoubleTapTriggered = {
                            forceLikeAction()
                        }
                    )

                    // ==========================================
                    // 1. CAPTION OVERLAY BOX (BOTTOM START)
                    // ==========================================
                    if (loopCaptionText.isNotEmpty() || loopUsernameText != "@user") {
                        var isExpanded by remember { mutableStateOf(false) }
                        var showProfilePrompt by remember { mutableStateOf(false) }
                        val captionScrollState = rememberScrollState()

                        LaunchedEffect(pagerState.currentPage == page) {
                            if (pagerState.currentPage != page) {
                                isExpanded = false
                                showProfilePrompt = false
                                captionScrollState.scrollTo(0)
                            }
                        }

                        Box(
                            modifier = Modifier
                                .fillMaxWidth(0.75f) 
                                .align(Alignment.BottomStart)
                                .padding(start = 20.dp, end = 16.dp, bottom = 64.dp)
                                .background(
                                    color = if (isExpanded) Color.Black.copy(alpha = 0.58f) else Color.Transparent,
                                    shape = RoundedCornerShape(8.dp)
                               ) 
                                .clickable(
                                    interactionSource = remember { MutableInteractionSource() },
                                    indication = null 
                                ) {
                                    isExpanded = !isExpanded
                                }
                                .padding(10.dp)
                        ) {
                            Column(modifier = Modifier.fillMaxWidth()) {
                                // Clickable Row for Account Target
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    modifier = Modifier
                                        .padding(bottom = 6.dp)
                                        .clickable { showProfilePrompt = !showProfilePrompt }
                                ) {
                                    if (loopPfpBitmap != null) {
                                        Image(
                                            bitmap = loopPfpBitmap,
                                            contentDescription = "Profile Picture",
                                            contentScale = ContentScale.Crop,
                                            modifier = Modifier
                                                .size(36.dp)
                                                .clip(CircleShape)
                                                .background(Color.DarkGray)
                                        )
                                    } else {
                                        Box(
                                            modifier = Modifier
                                                .size(36.dp)
                                                .clip(CircleShape)
                                                .background(Color.DarkGray)
                                        )
                                    }
                                    
                                    Spacer(modifier = Modifier.width(8.dp))
                                    
                                    Text(
                                        text = loopUsernameText,
                                        color = Color.White,
                                        fontSize = 14.sp,
                                        fontWeight = FontWeight.Bold,
                                        style = MaterialTheme.typography.bodyMedium
                                    )

                                    if (loopIsVerified) {
                                        Spacer(modifier = Modifier.width(4.dp))
                                        Icon(
                                            imageVector = Icons.Default.Star,
                                            contentDescription = "Verified Badge",
                                            tint = Color(0xFF3897F0), 
                                            modifier = Modifier.size(18.dp)
                                        )
                                    }
                                }

                                // NEW: "check profile?" Micro-Translucent Instagram Style Banner Overlay block
                                AnimatedVisibility(
                                    visible = showProfilePrompt,
                                    enter = fadeIn() + expandVertically(),
                                    exit = fadeOut() + shrinkVertically()
                                ) {
                                    Text(
                                        text = "Check Profile",
                                        color = Color.White.copy(alpha = 0.9f),
                                        fontSize = 11.sp,
                                        fontWeight = FontWeight.SemiBold,
                                        style = MaterialTheme.typography.bodySmall,
                                        modifier = Modifier
                                            .padding(bottom = 8.dp, start = 2.dp)
                                            .background(Color.White.copy(alpha = 0.2f), shape = RoundedCornerShape(4.dp))
                                            .clickable {
                                                openProfileAction(loopUsernameText)
                                                showProfilePrompt = false
                                            }
                                            .padding(horizontal = 8.dp, vertical = 4.dp)
                                    )
                                }

                                var totalLinesCount by remember(loopCaptionText) { mutableIntStateOf(1) }

                                Text(
                                    text = loopCaptionText,
                                    color = Color.White,
                                    fontSize = 13.sp,
                                    style = MaterialTheme.typography.bodyMedium,
                                    maxLines = if (isExpanded) Int.MAX_VALUE else 1, 
                                    overflow = if (isExpanded) TextOverflow.Clip else if (totalLinesCount > 1) TextOverflow.Ellipsis else TextOverflow.Clip,
                                    onTextLayout = { textLayoutResult ->
                                        totalLinesCount = textLayoutResult.lineCount
                                    },
                                    modifier = if (isExpanded) {
                                        Modifier
                                            .heightIn(max = 180.dp)
                                            .verticalScroll(captionScrollState)
                                    } else {
                                        Modifier
                                    }
                                )

                                if (loopViewCountText.isNotEmpty()) {
                                    Spacer(modifier = Modifier.height(8.dp))
                                    Row(
                                        verticalAlignment = Alignment.CenterVertically,
                                        modifier = Modifier.alpha(0.85f)
                                    ) {
                                        Text(
                                            text = "$loopViewCountText views",
                                            color = Color.White,
                                            fontSize = 12.sp,
                                            fontWeight = FontWeight.Medium,
                                            style = MaterialTheme.typography.bodySmall
                                        )
                                    }
                                }
                            }
                        }
                    }

                    // ==========================================
                    // 2. ENGAGEMENT ACTIONS SIDEBAR (BOTTOM END)
                    // ==========================================
                    // UPDATED: Shifted bottom padding safely up to 260.dp to compensate vertically for extra button layout modules
                    Column(
                        modifier = Modifier
                            .align(Alignment.BottomEnd)
                            .padding(end = 16.dp, bottom = 260.dp), 
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        // Like Metric Unit Block
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            IconButton(
                                onClick = { toggleLikeAction() },
                                colors = IconButtonDefaults.iconButtonColors(containerColor = Color.Transparent),
                                modifier = Modifier.size(44.dp)
                            ) {
                                Icon(
                                    imageVector = instagramHeartIcon,
                                    contentDescription = "Like Toggle",
                                    tint = Color.Unspecified, 
                                    modifier = Modifier.size(32.dp) 
                                )
                            }
                            if (loopLikeCountText.isNotEmpty()) {
                                Text(
                                    text = loopLikeCountText,
                                    color = Color.White,
                                    fontSize = 13.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    modifier = Modifier.padding(top = 0.dp)
                                )
                            }
                        }

                        // Save Action Unit Block
                        IconButton(
                            onClick = { if (loopVideoFile != null) toggleSaveAction(loopVideoFile) },
                            colors = IconButtonDefaults.iconButtonColors(containerColor = Color.Transparent),
                            modifier = Modifier.size(44.dp)
                        ) {
                            Icon(
                                imageVector = instagramSaveIcon,
                                contentDescription = "Save Toggle",
                                tint = Color.Unspecified, 
                                modifier = Modifier.size(30.dp) 
                            )
                        }

                        // NEW: Open in Instagram Deep Link Execution Component Module
                        IconButton(
                            onClick = { if (loopReelId.isNotEmpty()) openInstagramAction(loopReelId) },
                            colors = IconButtonDefaults.iconButtonColors(containerColor = Color.Transparent),
                            modifier = Modifier.size(44.dp)
                        ) {
                            Icon(
                                imageVector = instagramAppIcon,
                                contentDescription = "Open in Instagram App",
                                tint = Color.Unspecified, 
                                modifier = Modifier.size(30.dp) 
                            )
                        }

                        IconButton(
                            onClick = { if (loopReelId.isNotEmpty()) shareReelAction(loopReelId) },
                            colors = IconButtonDefaults.iconButtonColors(containerColor = Color.Transparent),
                            modifier = Modifier.size(44.dp)
                        ) {
                            Icon(
                                imageVector = instagramShareIcon,
                                contentDescription = "Share Link Outward",
                                tint = Color.Unspecified, 
                                modifier = Modifier.size(30.dp) 
                            )
                        }
                    }

                    // ==========================================
                    // 3. SQUARE MUSIC INFO WITH PICTURE (BOTTOM END)
                    // ==========================================
                    if (loopAudioTrackText.isNotEmpty()) {
                        Column(
                            modifier = Modifier
                                .align(Alignment.BottomEnd)
                                .padding(end = 16.dp, bottom = 64.dp)
                                .width(72.dp),
                            horizontalAlignment = Alignment.CenterHorizontally
                        ) {
                            val audioImageBitmap = if (isOriginalAudio) (loopPfpBitmap ?: loopSongBitmap) else loopSongBitmap

if (audioImageBitmap != null) {
    Image(
        bitmap = audioImageBitmap,
        contentDescription = "Song Album Art",
        contentScale = ContentScale.Crop,
        modifier = Modifier
            .size(40.dp)
            .clip(RoundedCornerShape(4.dp))
            .background(Color.DarkGray)
    )
}
                            
                            Spacer(modifier = Modifier.height(4.dp))
                            
                            Text(
                                text = loopAudioTrackText,
                                color = Color.White,
                                fontSize = 10.sp,
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis,
                                style = MaterialTheme.typography.bodySmall,
                                modifier = Modifier.fillMaxWidth(),
                                textAlign = androidx.compose.ui.text.style.TextAlign.Center
                            )
                        }
                    }
                }
            }
        }

        // Persistent Headbar Overlays
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .statusBarsPadding()
                .padding(top = 10.dp)
                .align(Alignment.TopCenter),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            if (videoFiles.isNotEmpty()) {
                Box(modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp)) {
                    val overallPagerProgress = (pagerState.currentPage + 1).toFloat() / videoFiles.size.toFloat()
                    LinearProgressIndicator(
                        progress = { overallPagerProgress },
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(2.5.dp),
                        color = Color.White.copy(alpha = 0.65f),
                        trackColor = Color.White.copy(alpha = 0.15f)
                    )
                }
                
                Spacer(modifier = Modifier.height(4.dp))
            }
            
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp)
            ) {
                IconButton(
                    onClick = { showSettingsDialog = true },
                    colors = IconButtonDefaults.iconButtonColors(containerColor = Color.Transparent),
                    modifier = Modifier
                        .align(Alignment.CenterStart)
                        .size(44.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.Settings,
                        contentDescription = "Open App Settings",
                        tint = Color.White,
                        modifier = Modifier.size(26.dp)
                    )
                }

                if (videoFiles.isNotEmpty()) {
                    Text(
                        text = "${pagerState.currentPage + 1} / ${videoFiles.size}",
                        style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp, letterSpacing = 0.5.sp),
                        color = Color.White.copy(alpha = 0.75f),
                        modifier = Modifier.align(Alignment.Center)
                    )
                }

                IconButton(
                    onClick = { refreshTrigger++ },
                    colors = IconButtonDefaults.iconButtonColors(containerColor = Color.Transparent),
                    modifier = Modifier
                        .align(Alignment.CenterEnd)
                        .size(44.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.Refresh,
                        contentDescription = "Refresh UI",
                        tint = Color.White,
                        modifier = Modifier.size(26.dp)
                    )
                }
            }
        }

        // Engine Action Deployment Pillar
        Column(
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .padding(end = 16.dp, bottom = 165.dp) 
                .navigationBarsPadding(),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            BadgedBox(
                badge = {
                    Box(
                        modifier = Modifier
                            .size(9.dp)
                            .background(
                                color = if (isTermuxRunning) Color.Green else Color.Gray,
                                shape = androidx.compose.foundation.shape.CircleShape
                            )
                    )
                }
            ) {
                IconButton(
                    onClick = { 
                        onLaunchTermux()
                    },
                    colors = IconButtonDefaults.iconButtonColors(containerColor = Color.Black.copy(alpha = 0.45f)),
                    modifier = Modifier.size(48.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.PlayArrow,
                        contentDescription = "Deploy Engine",
                        tint = Color.White,
                        modifier = Modifier.size(24.dp)
                    )
                }
            }
        }

        if (videoFiles.isNotEmpty() && pagerState.currentPage == videoFiles.size - 1) {
            LaunchedEffect(Unit) {
                showDialog = true
            }
        }

        if (showDialog) {
            AlertDialog(
                onDismissRequest = { showDialog = false },
                title = { Text("Purge Cache?") },
                text = { Text("Would you like to clear these viewed clips out of storage?") },
                confirmButton = {
                    TextButton(
                        onClick = {
                            showDialog = false
                            playerPool.forEach { it.stop() }
                            onFeedFinished {
                                refreshTrigger++
                            }
                        }
                    ) { Text("Purge") }
                },
                dismissButton = {
                    TextButton(onClick = { showDialog = false }) { Text("Keep") }
                }
            )
        }

        if (showSettingsDialog) {
            AlertDialog(
                onDismissRequest = { showSettingsDialog = false },
                title = { Text("Configurations") },
                text = {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Column(modifier = Modifier.weight(1f).padding(end = 8.dp)) {
                            Text("Use Background Intent", fontWeight = FontWeight.Bold, fontSize = 14.sp)
                            Text("Turning this off fixes launch termux button on some devices. You will need to reconfigure in termux after a change.(Run command: ./insta-bulk-grabber/configure.sh)", fontSize = 12.sp, color = Color.Gray)
                        }
                        Switch(
                            checked = useBackgroundIntent,
                            onCheckedChange = { isChecked ->
                                useBackgroundIntent = isChecked
                                prefs.edit().putBoolean("USE_BACKGROUND_INTENT", isChecked).apply()
                            }
                        )
                    }
                },
                confirmButton = {
                    TextButton(onClick = { showSettingsDialog = false }) {
                        Text("Save & Close")
                    }
                }
            )
        }
    } 
} 

@Composable
fun SharedPlayerItemSurface(
    exoPlayer: ExoPlayer, 
    isCurrentPage: Boolean,
    onDoubleTapTriggered: () -> Unit
) {
    val lifecycleOwner = LocalLifecycleOwner.current
    
    var shouldBePlaying by remember { mutableStateOf(true) }
    var progress by remember { mutableFloatStateOf(0f) }
    var isUserDraggingProgress by remember { mutableStateOf(false) }
    var displaysHeartOverlay by remember { mutableStateOf(false) }

    LaunchedEffect(isCurrentPage) {
        if (!isCurrentPage) {
            shouldBePlaying = true 
        }
    }

    LaunchedEffect(isCurrentPage, shouldBePlaying) {
        if (isCurrentPage) {
            while (true) {
                if (!isUserDraggingProgress && exoPlayer.isPlaying) {
                    val timelineDuration = exoPlayer.duration.toFloat()
                    if (timelineDuration > 0) {
                        progress = exoPlayer.currentPosition.toFloat() / timelineDuration
                    }
                }
                delay(16)
            }
        }
    }

    LaunchedEffect(displaysHeartOverlay) {
        if (displaysHeartOverlay) {
            delay(500)
            displaysHeartOverlay = false
        }
    }

    DisposableEffect(lifecycleOwner, isCurrentPage) {
        val observer = LifecycleEventObserver { _, event ->
            if (isCurrentPage) {
                when (event) {
                    Lifecycle.Event.ON_PAUSE -> { 
                        exoPlayer.pause() 
                    }
                    Lifecycle.Event.ON_RESUME -> { 
                        // Clean wake restoration: play directly without causing main-thread pipeline reinitialization
                        if (shouldBePlaying) {
                            exoPlayer.play()
                        }
                    }
                    else -> {}
                }
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    Box(modifier = Modifier.fillMaxSize()) {
        AndroidView(
            factory = { ctx ->
                PlayerView(ctx).apply {
                    useController = false
                    player = exoPlayer
                    resizeMode = androidx.media3.ui.AspectRatioFrameLayout.RESIZE_MODE_FIT
                    setBackgroundColor(android.graphics.Color.BLACK)
                }
            },
            update = { playerView -> 
                // Only touch the layout binding if the container instance tracking mismatched
                if (playerView.player != exoPlayer) {
                    playerView.player = exoPlayer
                }
            },
            onRelease = { playerView ->
                playerView.player = null 
            },
            modifier = Modifier
                .fillMaxSize()
                .pointerInput(isCurrentPage, exoPlayer) {
                    detectTapGestures(
                        onTap = {
                            if (isCurrentPage) {
                                val targetState = !exoPlayer.isPlaying
                                shouldBePlaying = targetState
                                exoPlayer.playWhenReady = targetState
                            }
                        },
                        onDoubleTap = {
                            if (isCurrentPage) {
                                displaysHeartOverlay = true
                                onDoubleTapTriggered()
                            }
                        }
                    )
                }
        )

        AnimatedVisibility(
            visible = displaysHeartOverlay && isCurrentPage,
            enter = fadeIn() + scaleIn(initialScale = 0.5f),
            exit = fadeOut() + scaleOut(targetScale = 1.3f),
            modifier = Modifier.align(Alignment.Center)
        ) {
            Icon(
                imageVector = Icons.Default.Favorite,
                contentDescription = "Saved Pop Indicator",
                tint = Color.White.copy(alpha = 0.85f),
                modifier = Modifier.size(100.dp)
            )
        }

        if (isCurrentPage) {
            BoxWithConstraints(
                modifier = Modifier
                    .fillMaxWidth()
                    .align(Alignment.BottomCenter)
                    .padding(start = 16.dp, end = 16.dp, bottom = 24.dp)
                    .height(24.dp)
                    .pointerInput(exoPlayer) {
                        detectTapGestures { offset ->
                            val layoutWidth = size.width.toFloat()
                            if (layoutWidth > 0) {
                                val touchFraction = (offset.x / layoutWidth).coerceIn(0f, 1f)
                                progress = touchFraction
                                val computedSeekMs = (touchFraction * exoPlayer.duration).toLong()
                                exoPlayer.seekTo(computedSeekMs)
                            }
                        }
                    }
                    .pointerInput(exoPlayer) {
                        detectDragGestures(
                            onDragStart = { isUserDraggingProgress = true },
                            onDragEnd = {
                                val computedSeekMs = (progress * exoPlayer.duration).toLong()
                                exoPlayer.seekTo(computedSeekMs)
                                isUserDraggingProgress = false
                            },
                            onDragCancel = { isUserDraggingProgress = false }, // Safeguard handle state
                            onDrag = { change, dragAmount ->
                                change.consume()
                                val layoutWidth = size.width.toFloat()
                                if (layoutWidth > 0) {
                                    val deltaFraction = dragAmount.x / layoutWidth
                                    progress = (progress + deltaFraction).coerceIn(0f, 1f)
                                }
                            }
                        )
                    }
            ) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(3.dp)
                        .align(Alignment.Center)
                        .background(Color.White.copy(alpha = 0.24f), shape = RoundedCornerShape(1.5.dp))
                )
                
                Box(
                    modifier = Modifier
                        .fillMaxWidth(fraction = progress)
                        .height(3.dp)
                        .align(Alignment.CenterStart)
                        .background(Color.White, shape = RoundedCornerShape(1.5.dp))
                )
            }
        }
    }
}