package com.kulvar.app;

import android.Manifest;
import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.Window;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * Kulvar Android kabuğu.
 * Web uygulaması assets/www içinden https://appassets.androidplatform.net/ adresiyle sunulur;
 * böylece localStorage ve güvenli bağlam çalışır. Bildirimler yerel Android bildirimiyle gösterilir.
 */
public class MainActivity extends Activity {
    static final String HOST = "appassets.androidplatform.net";
    static final String START_URL = "https://" + HOST + "/index.html";
    static final String CHANNEL = "results";
    static final String EXTRA_LINK = "link";
    private static final int REQ_NOTIF = 21;
    private static final int REQ_FILE = 22;

    private WebView webView;
    private ValueCallback<Uri[]> pendingFileCallback;
    private int notifId = 1;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        createChannel();
        webView = new WebView(this);
        webView.setBackgroundColor(0xFFF4F6FA);
        setContentView(webView);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setTextZoom(100);
        s.setUserAgentString(s.getUserAgentString() + " KulvarAndroid/1.2.0");

        webView.addJavascriptInterface(new Bridge(), "KulvarAndroid");
        webView.setWebViewClient(new AssetClient());
        webView.setWebChromeClient(new Chrome());

        if (savedInstanceState != null) webView.restoreState(savedInstanceState);
        else webView.loadUrl(START_URL + linkFrom(getIntent()));
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        String link = linkFrom(intent);
        if (!link.isEmpty()) webView.loadUrl(START_URL + link);
    }

    static String linkFrom(Intent intent) {
        String link = intent == null ? null : intent.getStringExtra(EXTRA_LINK);
        return link != null && link.startsWith("#/") ? link : "";
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    public void onBackPressed() {
        webView.evaluateJavascript("(window.kulvarBack&&window.kulvarBack())?'1':'0'", new ValueCallback<String>() {
            @Override
            public void onReceiveValue(String value) {
                if (!"\"1\"".equals(value)) moveTaskToBack(true);
            }
        });
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL, "Sporcu sonuçları", NotificationManager.IMPORTANCE_DEFAULT);
        ch.setDescription("Takip edilen sporcuların yeni dereceleri");
        getSystemService(NotificationManager.class).createNotificationChannel(ch);
    }

    private String permissionState() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT < 33) return nm.areNotificationsEnabled() ? "granted" : "denied";
        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
            return nm.areNotificationsEnabled() ? "granted" : "denied";
        }
        SharedPreferences p = getPreferences(MODE_PRIVATE);
        boolean asked = p.getBoolean("notifAsked", false);
        if (asked && !shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS)) return "denied";
        return "default";
    }

    /** assets/www içeriğini sanal https alan adından sunar. */
    private class AssetClient extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (!HOST.equals(uri.getHost())) return null;
            String path = uri.getPath();
            if (path == null || path.equals("/") || path.isEmpty()) path = "/index.html";
            try {
                InputStream in = getAssets().open("www" + path);
                WebResourceResponse r = new WebResourceResponse(mime(path), "utf-8", in);
                Map<String, String> h = new HashMap<String, String>();
                h.put("Cache-Control", "no-cache");
                r.setResponseHeaders(h);
                return r;
            } catch (IOException e) {
                return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", null, null);
            }
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (HOST.equals(uri.getHost())) return false;
            openExternal(uri);
            return true;
        }
    }

    private class Chrome extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (pendingFileCallback != null) pendingFileCallback.onReceiveValue(null);
            pendingFileCallback = callback;
            Intent i = new Intent(Intent.ACTION_GET_CONTENT);
            i.addCategory(Intent.CATEGORY_OPENABLE);
            i.setType("*/*");
            try {
                startActivityForResult(Intent.createChooser(i, "Dosya seç"), REQ_FILE);
            } catch (ActivityNotFoundException e) {
                pendingFileCallback = null;
                return false;
            }
            return true;
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        if (requestCode == REQ_NOTIF) webView.evaluateJavascript("window.kulvarNotifChanged&&window.kulvarNotifChanged()", null);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILE && pendingFileCallback != null) {
            Uri[] result = null;
            if (resultCode == RESULT_OK && data != null && data.getData() != null) result = new Uri[]{data.getData()};
            pendingFileCallback.onReceiveValue(result);
            pendingFileCallback = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    private void openExternal(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "Bu bağlantıyı açacak uygulama yok", Toast.LENGTH_SHORT).show();
        }
    }

    static String mime(String path) {
        String p = path.toLowerCase();
        if (p.endsWith(".html")) return "text/html";
        if (p.endsWith(".js")) return "application/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".json") || p.endsWith(".webmanifest")) return "application/json";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".png")) return "image/png";
        return "application/octet-stream";
    }

    static String safeName(String name) {
        String n = name == null ? "dosya" : name.replaceAll("[\\\\/:*?\"<>|]", "_");
        return n.isEmpty() ? "dosya" : n;
    }

    /** JavaScript tarafından window.KulvarAndroid olarak çağrılır. */
    private class Bridge {
        @JavascriptInterface
        public String notifPermission() { return permissionState(); }

        @JavascriptInterface
        public void requestNotif() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    String state = permissionState();
                    if (Build.VERSION.SDK_INT >= 33 && "default".equals(state)) {
                        getPreferences(MODE_PRIVATE).edit().putBoolean("notifAsked", true).apply();
                        requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIF);
                    } else if (!"granted".equals(state)) {
                        Intent i = new Intent("android.settings.APP_NOTIFICATION_SETTINGS");
                        i.putExtra("android.provider.extra.APP_PACKAGE", getPackageName());
                        try { startActivity(i); } catch (ActivityNotFoundException e) {
                            Toast.makeText(MainActivity.this, "Bildirimleri ayarlardan açın", Toast.LENGTH_LONG).show();
                        }
                    }
                }
            });
        }

        @JavascriptInterface
        public void showNotification(final String title, final String body, final String link) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if (!"granted".equals(permissionState())) return;
                    Intent open = new Intent(MainActivity.this, MainActivity.class);
                    open.putExtra(EXTRA_LINK, link);
                    open.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
                    int id = notifId++;
                    PendingIntent pi = PendingIntent.getActivity(MainActivity.this, id, open,
                            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
                    Notification.Builder b = Build.VERSION.SDK_INT >= 26
                            ? new Notification.Builder(MainActivity.this, CHANNEL)
                            : new Notification.Builder(MainActivity.this);
                    b.setSmallIcon(R.drawable.ic_stat)
                            .setContentTitle(title)
                            .setContentText(body)
                            .setStyle(new Notification.BigTextStyle().bigText(body))
                            .setContentIntent(pi)
                            .setAutoCancel(true);
                    ((NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE)).notify(id, b.build());
                }
            });
        }

        /** Dosyayı İndirilenler/Kulvar klasörüne kaydeder; dönen değer kullanıcıya gösterilecek konumdur. */
        @JavascriptInterface
        public String saveFile(String name, String base64, String mime) {
            byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
            try {
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.MediaColumns.DISPLAY_NAME, safeName(name));
                    v.put(MediaStore.MediaColumns.MIME_TYPE, mime);
                    v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Kulvar");
                    Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                    if (uri == null) throw new IOException("MediaStore");
                    OutputStream out = getContentResolver().openOutputStream(uri);
                    try { out.write(bytes); } finally { out.close(); }
                    return "İndirilenler/Kulvar/" + safeName(name);
                }
                File dir = new File(getExternalFilesDir(null), "Kulvar");
                if (!dir.exists()) dir.mkdirs();
                File f = new File(dir, safeName(name));
                FileOutputStream out = new FileOutputStream(f);
                try { out.write(bytes); } finally { out.close(); }
                return f.getAbsolutePath();
            } catch (Exception e) {
                return "";
            }
        }

        @JavascriptInterface
        public void shareText(String text) {
            final Intent i = new Intent(Intent.ACTION_SEND);
            i.setType("text/plain");
            i.putExtra(Intent.EXTRA_TEXT, text);
            runOnUiThread(new Runnable() {
                @Override
                public void run() { startActivity(Intent.createChooser(i, "Paylaş")); }
            });
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) webView.destroy();
        super.onDestroy();
    }
}
