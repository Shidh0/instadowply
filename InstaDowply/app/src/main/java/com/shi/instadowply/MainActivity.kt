package com.shi.instadowply

import androidx.compose.ui.platform.LocalContext
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import java.io.File
import android.widget.Toast

class MainActivity : ComponentActivity() {

    private lateinit var sharedReelsDir: File
    private lateinit var oldReelsDir: File 

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val publicStorage = Environment.getExternalStorageDirectory()
        oldReelsDir = File(publicStorage, "Reels")    
        sharedReelsDir = File(publicStorage, ".Reels") 

        val prefs = getSharedPreferences("instadowply_cache", Context.MODE_PRIVATE)
        val initialSavedIndex = prefs.getInt("LAST_WATCHED_INDEX", 0)

        setContent {
    MaterialTheme {
        Surface(
            modifier = Modifier.fillMaxSize(),
            color = MaterialTheme.colorScheme.background
        ) {
            val context = LocalContext.current
            var showPermissionDialog by remember { mutableStateOf(false) }
            
            var showTermuxPermissionDialog by remember { mutableStateOf(false) }

            fun hasTermuxPermission(): Boolean {
                return ContextCompat.checkSelfPermission(
                    context, 
                    "com.termux.permission.RUN_COMMAND"
                ) == PackageManager.PERMISSION_GRANTED
            }

            LaunchedEffect(Unit) {
                if (!Environment.isExternalStorageManager()) {
                    showPermissionDialog = true
                } else if (!hasTermuxPermission()) {
                    showTermuxPermissionDialog = true
                } else {
                    handleMigrationAndFolderSetup()
                }
            }

            ReelPlayerScreen(
                videoDirectory = sharedReelsDir,
                initialPage = initialSavedIndex,
                onPageChanged = { index -> saveProgressState(index) },
                onFeedFinished = { onRefreshReady -> purgeCache { onRefreshReady() } },
                onLaunchTermux = { 
                    if (hasTermuxPermission()) {
                        launchTermuxScript()
                    } else {
                        showTermuxPermissionDialog = true
                    }
                }
            )
            
            if (showPermissionDialog) {
                AlertDialog(
                    onDismissRequest = { },
                    title = { Text("Storage Access Required") },
                    text = { Text("InstaDowply needs 'All Files Access' to play video streams from your shared storage folder.\n\nPlease enable it on the next screen.") },
                    confirmButton = {
                        TextButton(
                            onClick = {
                                showPermissionDialog = false
                                openAllFilesAccessSettings()
                            }
                        ) { Text("Grant Access") }
                    },
                    dismissButton = {
                        TextButton(onClick = { finish() }) { Text("Exit App") }
                    }
                )
            }

            if (showTermuxPermissionDialog) {
                AlertDialog(
                    onDismissRequest = { showTermuxPermissionDialog = false },
                    title = { Text("Termux Automation Required") },
                    text = { 
                        Text("InstaDowply needs authorization to pass back-end commands to Termux to execute your scraping scripts.\n\n" +
                             "Please tap Grant, look for 'Additional Permissions' or 'Permissions', and allow 'Run commands in Termux environment'.") 
                    },
                    confirmButton = {
                        TextButton(
                            onClick = {
                                showTermuxPermissionDialog = false
                                try {
                                    val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                                        data = Uri.fromParts("package", packageName, null)
                                    }
                                    startActivity(intent)
                                } catch (e: Exception) {
                                    e.printStackTrace()
                                }
                            }
                        ) { Text("Grant Access") }
                    },
                    dismissButton = {
                        TextButton(onClick = { showTermuxPermissionDialog = false }) { Text("Cancel") }
                    }
                )
            }
        }
    }
}
}

    override fun onResume() {
        super.onResume()
        if (Environment.isExternalStorageManager()) {
            handleMigrationAndFolderSetup()
        }
    }

    private fun handleMigrationAndFolderSetup() {
        lifecycleScope.launch {
            
            withContext(Dispatchers.IO) {
                try {
                    if (oldReelsDir.exists() && oldReelsDir.isDirectory) {
                        if (!sharedReelsDir.exists()) {
                            sharedReelsDir.mkdirs()
                        }

                        val legacyFiles = oldReelsDir.listFiles()
                        legacyFiles?.forEach { file ->
                            if (file.isFile) {
                                val destinationTarget = File(sharedReelsDir, file.name)
                                val movedSuccessfully = file.renameTo(destinationTarget)
                                if (!movedSuccessfully) {
                                    try {
                                        file.inputStream().use { input ->
                                            destinationTarget.outputStream().use { output ->
                                                input.copyTo(output)
                                            }
                                        }
                                        file.delete()
                                    } catch (e: Exception) {
                                        e.printStackTrace()
                                    }
                                }
                            }
                        }

                        if (oldReelsDir.listFiles()?.isEmpty() == true) {
                            oldReelsDir.delete()
                        }
                    } else {
                        if (!sharedReelsDir.exists()) {
                            sharedReelsDir.mkdirs()
                        }
                    }
                } catch (e: Exception) {
                    e.printStackTrace()
                }
            }
            
        }
    }
    
    private fun saveProgressState(index: Int) {
        val prefs = getSharedPreferences("instadowply_cache", Context.MODE_PRIVATE)
        prefs.edit().putInt("LAST_WATCHED_INDEX", index).apply()
    }

    private fun openAllFilesAccessSettings() {
        try {
            val intent = Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION).apply {
                addCategory(Intent.CATEGORY_DEFAULT)
                data = Uri.parse("package:$packageName")
            }
            startActivity(intent)
        } catch (e: Exception) {
            val intent = Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION)
            startActivity(intent)
        }
    }

    private fun launchTermuxScript() {
    val prefs = getSharedPreferences("instadowply_cache", Context.MODE_PRIVATE)
    val useBackgroundIntent = prefs.getBoolean("USE_BACKGROUND_INTENT", true)

    if (useBackgroundIntent) {
        try {
            val intent = Intent().apply {
                setClassName("com.termux", "com.termux.app.RunCommandService")
                action = "com.termux.RUN_COMMAND"
                putExtra("com.termux.RUN_COMMAND_PATH", "/data/data/com.termux/files/home/sync_reels.sh")
                putExtra("com.termux.RUN_COMMAND_WORKDIR", "/data/data/com.termux/files/home")
                putExtra("com.termux.RUN_COMMAND_BACKGROUND", true)
            }
            startService(intent)
        } catch (e: Exception) {
            e.printStackTrace()
            Toast.makeText(this, "Failed to connect to Termux engine backend.", Toast.LENGTH_LONG).show()
        }
    } else {
        try {
            // Stage 1: Attempt standard package launch manager routing
            var intent = packageManager.getLaunchIntentForPackage("com.termux")
            
            // Stage 2: Aggressive Fallback - Explicitly target Termux main system activity 
            // This bypasses package visibility filtering restrictions on Android 11+
            if (intent == null) {
                intent = Intent().apply {
                    setClassName("com.termux", "com.termux.app.TermuxActivity")
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
            }
            startActivity(intent)
        } catch (e: Exception) {
            e.printStackTrace()
            // Stage 3: Ultra-Aggressive Fallback - Absolute structural fallback intent
            try {
                val fallbackIntent = Intent(Intent.ACTION_MAIN).apply {
                    setClassName("com.termux", "com.termux.app.TermuxActivity")
                    addCategory(Intent.CATEGORY_LAUNCHER)
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                startActivity(fallbackIntent)
            } catch (ex: Exception) {
                ex.printStackTrace()
                Toast.makeText(this, "Termux application could not be located or targeted.", Toast.LENGTH_LONG).show()
            }
        }
    }
}
private fun purgeCache(onComplete: () -> Unit) {
    lifecycleScope.launch(Dispatchers.IO) {
        try {
            if (Environment.isExternalStorageManager() && sharedReelsDir.exists()) {
                sharedReelsDir.listFiles()?.forEach { file ->
                    if (file.isFile && file.name.startsWith("reel_")) {
                        file.delete()
                    }
                }
                saveProgressState(0)
            }
            withContext(Dispatchers.Main) {
                onComplete()
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }
}

    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        try {
            this.currentFocus?.clearFocus()
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }
}