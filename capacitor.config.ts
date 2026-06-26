import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  // Reverse-DNS app id. This becomes the Android package name and is PERMANENT
  // once published to Play. Change to your real domain before a store release.
  appId: 'com.vyact.consumer',
  appName: 'Vyact',

  // Vite outputs the production web bundle here. If your build emits to a
  // different folder, change this to match (e.g. 'build').
  webDir: 'dist',

  server: {
    // Serve the bundled assets over the https scheme inside the WebView so
    // Supabase auth, secure cookies and service workers behave like production.
    androidScheme: 'https',
  },

  android: {
    // Finance app: never silently load insecure (http) sub-resources.
    allowMixedContent: false,
  },

  plugins: {
    // Branded launch splash (pip on the Cream canvas). The generated splash
    // images come from @capacitor/assets; this controls how it's shown. The
    // in-HTML pip loader (index.html) covers the brief handoff to React.
    SplashScreen: {
      launchShowDuration: 900,
      launchAutoHide: true,
      backgroundColor: '#F5EFE6',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
  },
};

export default config;
