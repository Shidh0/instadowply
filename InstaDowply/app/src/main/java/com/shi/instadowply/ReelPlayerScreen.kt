package com.shi.instadowply

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

@Composable
fun ReelPlayerScreen(
    videoDirectory: File,
    initialPage: Int,
    onPageChanged: (Int) -> Unit,
    onFeedFinished: () -> Unit,
    onLaunchTermux: () -> Unit
) {
    val context = LocalContext.current
    var refreshTrigger by remember { mutableIntStateOf(0) }
    var isTermuxRunning by remember { mutableStateOf(false) }

    LaunchedEffect(videoDirectory) {
        while (true) {
            val lockFile = File("/storage/emulated/0/.Reels/download.lock")
            isTermuxRunning = lockFile.exists()
            delay(2500)
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
    
    // Whenever the list becomes empty (like after a purge), safely snap the pager back to 0
LaunchedEffect(videoFiles.size) {
    if (videoFiles.isEmpty() && pagerState.currentPage != 0) {
        pagerState.scrollToPage(0)
    }
}
    
    var showDialog by remember { mutableStateOf(false) }

    val sharedExoPlayer = remember {
        ExoPlayer.Builder(context).build().apply {
            repeatMode = Player.REPEAT_MODE_ONE
            playWhenReady = true
        }
    }

    val currentVideoFile = videoFiles.getOrNull(pagerState.currentPage)
    val currentReelId = remember(currentVideoFile) {
        currentVideoFile?.nameWithoutExtension?.substringAfter("reel_") ?: ""
    }

    var isCurrentVideoLiked by remember(currentReelId) { mutableStateOf(false) }
    var isCurrentVideoSaved by remember(currentVideoFile) { mutableStateOf(false) }
    val likesJsonFile = remember { File("/storage/emulated/0/.Reels/pending_likes.json") }

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
                Toast.makeText(context, "Removed from InstaSaved", Toast.LENGTH_SHORT).show()
            } else {
                if (fileToSave.exists()) {
                    fileToSave.copyTo(destination, overwrite = true)
                    isCurrentVideoSaved = true
                    Toast.makeText(context, "Copied to Download/InstaSaved ✨", Toast.LENGTH_SHORT).show()
                }
            }
        } catch (e: Exception) {
            Toast.makeText(context, "Folder Save Error: ${e.message}", Toast.LENGTH_LONG).show()
        }
    }

    DisposableEffect(Unit) {
        onDispose {
            sharedExoPlayer.release()
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
                    text = "No reels found inside storage folder.\nFeed data via Termux!",
                    style = MaterialTheme.typography.bodyLarge,
                    color = Color.Gray
                )
            }
        } else {
            LaunchedEffect(pagerState.currentPage, videoFiles, refreshTrigger) {
                if (videoFiles.isNotEmpty() && pagerState.currentPage < videoFiles.size) {
                    val activeFile = videoFiles[pagerState.currentPage]
                    sharedExoPlayer.stop()
                    sharedExoPlayer.setMediaItem(MediaItem.fromUri(activeFile.absolutePath))
                    sharedExoPlayer.prepare()
                    sharedExoPlayer.playWhenReady = true
                }
            }

            VerticalPager(
                state = pagerState,
                modifier = Modifier.fillMaxSize()
            ) { page ->
                val loopVideoFile = videoFiles.getOrNull(page)
                
                val loopCaptionText = remember(loopVideoFile) {
                    if (loopVideoFile != null) {
                        val captionFile = File(loopVideoFile.parentFile, "${loopVideoFile.nameWithoutExtension}.txt")
                        if (captionFile.exists()) {
                            try { captionFile.readText() } catch (e: Exception) { "" }
                        } else ""
                    } else ""
                }

                val loopUsernameText = remember(loopVideoFile) {
                    if (loopVideoFile != null) {
                        val userFile = File(loopVideoFile.parentFile, "${loopVideoFile.nameWithoutExtension}_user.txt")
                        if (userFile.exists()) {
                            try { userFile.readText() } catch (e: Exception) { "@user" }
                        } else "@user"
                    } else "@user"
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

                Box(modifier = Modifier.fillMaxSize()) {
                    SharedPlayerItemSurface(
                        exoPlayer = sharedExoPlayer,
                        isCurrentPage = pagerState.currentPage == page,
                        onDoubleTapTriggered = {
                            forceLikeAction()
                        }
                    )

                    // 🏷️ CAPTION OVERLAY BOX
                    if (loopCaptionText.isNotEmpty() || loopUsernameText != "@user") {
                        var isExpanded by remember { mutableStateOf(false) }
                        val captionScrollState = rememberScrollState()

                        LaunchedEffect(pagerState.currentPage == page) {
                            if (pagerState.currentPage != page) {
                                isExpanded = false
                                captionScrollState.scrollTo(0)
                            }
                        }

                        Box(
                            modifier = Modifier
                                .fillMaxWidth(0.78f)
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
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    modifier = Modifier.padding(bottom = 8.dp)
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
                                }

                                Text(
                                    text = loopCaptionText,
                                    color = Color.White,
                                    fontSize = 13.sp,
                                    style = MaterialTheme.typography.bodyMedium,
                                    maxLines = if (isExpanded) Int.MAX_VALUE else 1, 
                                    overflow = if (isExpanded) TextOverflow.Clip else TextOverflow.Ellipsis,
                                    modifier = if (isExpanded) {
                                        Modifier
                                            .heightIn(max = 220.dp)
                                            .verticalScroll(captionScrollState)
                                    } else {
                                        Modifier
                                    }
                                )
                            }
                        }
                    }

                    // 🎬 Moving Player Sidebar Actions (Moves with scrolling layout, hides on 0 items)
                    Column(
                        modifier = Modifier
                            .align(Alignment.BottomEnd)
                            .padding(end = 16.dp, bottom = 160.dp), // Pushed above Termux layout boundary safely
                        verticalArrangement = Arrangement.spacedBy(16.dp),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        IconButton(
                            onClick = { toggleLikeAction() },
                            colors = IconButtonDefaults.iconButtonColors(containerColor = Color.Transparent),
                            modifier = Modifier.size(52.dp) 
                        ) {
                            Icon(
                                imageVector = instagramHeartIcon,
                                contentDescription = "Instagram Like Sync Toggle",
                                tint = Color.Unspecified, 
                                modifier = Modifier.size(32.dp) 
                            )
                        }

                        IconButton(
                            onClick = {
                                if (loopVideoFile != null) {
                                    toggleSaveAction(loopVideoFile)
                                }
                            },
                            colors = IconButtonDefaults.iconButtonColors(containerColor = Color.Transparent),
                            modifier = Modifier.size(52.dp) 
                        ) {
                            Icon(
                                imageVector = instagramSaveIcon,
                                contentDescription = "Save Reel To Folder Toggle",
                                tint = Color.Unspecified, 
                                modifier = Modifier.size(30.dp) 
                            )
                        }
                    }
                }
            }
        }

        // 📊 TOP STATUS CONTROLS COLUMN (Refresh stays up all the time)
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

        // 🚀 PERSISTENT OUTER SIDEBAR LAYER (Houses Termux button safely below player panels)
        Column(
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .padding(end = 16.dp, bottom = 82.dp) 
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
                        Toast.makeText(context, "Termux Script Signaled!", Toast.LENGTH_SHORT).show()
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
                text = { Text("Would you like to clear these viewed clips completely out of memory storage?") },
                confirmButton = {
                    TextButton(
                        onClick = {
                            showDialog = false
                            sharedExoPlayer.stop()
                            onFeedFinished()
                            refreshTrigger++
                        }
                    ) { Text("Purge & Refresh") }
                },
                dismissButton = {
                    TextButton(onClick = { showDialog = false }) { Text("Keep Streams") }
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
    var isPlaying by remember { mutableStateOf(true) }
    var progress by remember { mutableFloatStateOf(0f) }
    var isUserDraggingProgress by remember { mutableStateOf(false) }
    var displaysHeartOverlay by remember { mutableStateOf(false) }

    LaunchedEffect(isCurrentPage) {
        if (isCurrentPage) {
            isPlaying = true
            exoPlayer.playWhenReady = true
        }
    }

    LaunchedEffect(isCurrentPage, isPlaying) {
        if (isCurrentPage) {
            while (true) {
                if (isPlaying && !isUserDraggingProgress) {
                    val timelineDuration = exoPlayer.duration.toFloat()
                    if (timelineDuration > 0) {
                        progress = exoPlayer.currentPosition.toFloat() / timelineDuration
                    }
                }
                delay(200)
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
                    Lifecycle.Event.ON_PAUSE -> { exoPlayer.pause() }
                    Lifecycle.Event.ON_RESUME -> { if (isPlaying) exoPlayer.play() }
                    else -> {}
                }
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    Box(modifier = Modifier.fillMaxSize()) {
        if (isCurrentPage) {
            AndroidView(
                factory = { ctx ->
                    PlayerView(ctx).apply {
                        useController = false
                        player = exoPlayer
                        resizeMode = androidx.media3.ui.AspectRatioFrameLayout.RESIZE_MODE_FIT
                        setBackgroundColor(android.graphics.Color.BLACK)
                    }
                },
                update = { playerView -> playerView.player = exoPlayer },
                modifier = Modifier
                    .fillMaxSize()
                    .pointerInput(Unit) {
                        detectTapGestures(
                            onTap = {
                                isPlaying = !isPlaying
                                exoPlayer.playWhenReady = !isPlaying
                            },
                            onDoubleTap = {
                                displaysHeartOverlay = true
                                onDoubleTapTriggered()
                            }
                        )
                    }
            )
        } else {
            Box(modifier = Modifier.fillMaxSize())
        }

        AnimatedVisibility(
            visible = displaysHeartOverlay,
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
                            onDragCancel = { isUserDraggingProgress = false },
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