package com.session.studio;

import android.Manifest;
import android.app.Activity;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Base64;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Map;

/** Session for Android: the Session app runs in a full-screen WebView, served from inside the APK. */
public class MainActivity extends Activity {
    static final String HOST = "appassets.androidplatform.net";
    static final String START = "https://" + HOST + "/renderer/index.html";
    static final int REQ_MIC = 1, REQ_FILES = 2;

    WebView web;
    PermissionRequest pendingMic;
    ValueCallback<Uri[]> pendingFiles;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        web = new WebView(this);
        web.setBackgroundColor(0xFF101014);
        setContentView(web);
        immersive();

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setTextZoom(100);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);

        web.addJavascriptInterface(new Bridge(), "SessionAndroid");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                if (!HOST.equals(u.getHost())) return null;
                String path = u.getPath();
                if (path == null || path.equals("/")) path = "/index.html";
                if (path.contains("..")) return notFound();
                try {
                    InputStream in = getAssets().open("www" + path);
                    Map<String, String> h = new HashMap<>();
                    h.put("Cache-Control", "no-cache");
                    h.put("Access-Control-Allow-Origin", "*");
                    return new WebResourceResponse(mime(path), mime(path).startsWith("text") || path.endsWith(".js") || path.endsWith(".json") ? "utf-8" : null, 200, "OK", h, in);
                } catch (Exception e) {
                    return notFound();
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView v, String url) {
                Uri u = Uri.parse(url);
                if (HOST.equals(u.getHost())) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) {}
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest req) {
                runOnUiThread(new Runnable() {
                    public void run() {
                        boolean audio = false;
                        for (String res : req.getResources())
                            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(res)) audio = true;
                        if (!audio) { req.deny(); return; }
                        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                            req.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                        } else {
                            pendingMic = req;
                            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_MIC);
                        }
                    }
                });
            }

            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
                if (pendingFiles != null) pendingFiles.onReceiveValue(null);
                pendingFiles = cb;
                Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                if (p.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                try {
                    startActivityForResult(Intent.createChooser(i, "Choose a file"), REQ_FILES);
                } catch (Exception e) {
                    pendingFiles = null;
                    return false;
                }
                return true;
            }
        });

        if (state != null) web.restoreState(state);
        else web.loadUrl(START);
    }

    static WebResourceResponse notFound() {
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", new HashMap<String, String>(), null);
    }

    static String mime(String p) {
        p = p.toLowerCase();
        if (p.endsWith(".html")) return "text/html";
        if (p.endsWith(".js") || p.endsWith(".mjs")) return "text/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".json")) return "application/json";
        if (p.endsWith(".wasm")) return "application/wasm";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".ico")) return "image/x-icon";
        if (p.endsWith(".wav")) return "audio/wav";
        if (p.endsWith(".mp3")) return "audio/mpeg";
        if (p.endsWith(".woff2")) return "font/woff2";
        return "application/octet-stream";
    }

    void immersive() {
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
    }

    @Override
    public void onWindowFocusChanged(boolean focus) {
        super.onWindowFocusChanged(focus);
        if (focus) immersive();
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] res) {
        if (code == REQ_MIC && pendingMic != null) {
            if (res.length > 0 && res[0] == PackageManager.PERMISSION_GRANTED)
                pendingMic.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
            else pendingMic.deny();
            pendingMic = null;
        }
    }

    @Override
    protected void onActivityResult(int code, int result, Intent data) {
        if (code != REQ_FILES || pendingFiles == null) { super.onActivityResult(code, result, data); return; }
        Uri[] out = null;
        if (result == RESULT_OK && data != null) {
            ArrayList<Uri> list = new ArrayList<>();
            ClipData clip = data.getClipData();
            if (clip != null) for (int i = 0; i < clip.getItemCount(); i++) list.add(clip.getItemAt(i).getUri());
            else if (data.getData() != null) list.add(data.getData());
            out = list.toArray(new Uri[0]);
        }
        pendingFiles.onReceiveValue(out);
        pendingFiles = null;
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    public void onBackPressed() {
        // keep the session alive instead of closing it by accident
        moveTaskToBack(true);
    }

    @Override
    protected void onPause() { super.onPause(); web.onPause(); }

    @Override
    protected void onResume() { super.onResume(); web.onResume(); immersive(); }

    /* ---------- saving files (called from host-web.js) ---------- */

    File saveDir() {
        File d = new File(getExternalFilesDir(null), "Session");
        d.mkdirs();
        return d;
    }

    static String safe(String n) {
        n = n == null ? "session" : n.replaceAll("[\\\\/:*?\"<>|\\x00-\\x1f]+", "_").trim();
        return n.isEmpty() ? "session" : n;
    }

    class Bridge {
        final Map<String, OutputStream> open = new HashMap<>();
        final Map<String, File> files = new HashMap<>();
        int next = 1;

        @JavascriptInterface
        public String platform() { return "android"; }

        @JavascriptInterface
        public int versionCode() {
            try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionCode; }
            catch (Exception e) { return 0; }
        }

        @JavascriptInterface
        public String versionName() {
            try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; }
            catch (Exception e) { return ""; }
        }

        /** Open a link (e.g. the new APK) in the phone's browser so the person can install it. */
        @JavascriptInterface
        public void open(final String url) {
            runOnUiThread(new Runnable() {
                public void run() {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); }
                    catch (Exception ignored) {}
                }
            });
        }

        @JavascriptInterface
        public synchronized String begin(String name) throws Exception {
            String id = String.valueOf(next++);
            File f = new File(saveDir(), safe(name));
            files.put(id, f);
            open.put(id, new FileOutputStream(f));
            return id;
        }

        @JavascriptInterface
        public synchronized void append(String id, String b64) throws Exception {
            open.get(id).write(Base64.decode(b64, Base64.DEFAULT));
        }

        /** Closes the file, puts a copy in Downloads/Session and opens the share sheet. Returns where it was saved. */
        @JavascriptInterface
        public synchronized String finish(String id, boolean share) throws Exception {
            open.remove(id).close();
            final File f = files.remove(id);
            String where = "the Session app folder";
            Uri shareUri = Uri.parse("content://com.session.studio.files/" + Uri.encode(f.getName()));
            if (Build.VERSION.SDK_INT >= 29) {
                try {
                    ContentResolver cr = getContentResolver();
                    ContentValues cv = new ContentValues();
                    cv.put("_display_name", f.getName());
                    cv.put("mime_type", mime(f.getName()));
                    cv.put("relative_path", "Download/Session");
                    Uri u = cr.insert(Uri.parse("content://media/external/downloads"), cv);
                    if (u != null) {
                        try (OutputStream o = cr.openOutputStream(u); InputStream in = new FileInputStream(f)) {
                            byte[] buf = new byte[65536];
                            int n;
                            while ((n = in.read(buf)) > 0) o.write(buf, 0, n);
                        }
                        where = "Download/Session";
                    }
                } catch (Exception ignored) {}
            }
            if (share) {
                final Uri su = shareUri;
                runOnUiThread(new Runnable() {
                    public void run() {
                        Intent send = new Intent(Intent.ACTION_SEND);
                        send.setType(mime(f.getName()));
                        send.putExtra(Intent.EXTRA_STREAM, su);
                        send.putExtra(Intent.EXTRA_TITLE, f.getName());
                        send.setClipData(ClipData.newRawUri(f.getName(), su));
                        send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        try { startActivity(Intent.createChooser(send, "Save or send " + f.getName())); } catch (Exception ignored) {}
                    }
                });
            }
            return where;
        }
    }
}
