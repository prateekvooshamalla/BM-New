import type { ConfigContext, ExpoConfig } from 'expo/config';
import appJson from './app.json';

export default ({ config }: ConfigContext): ExpoConfig => {
  const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  const plugins = [...(config.plugins ?? [])];
  if (iosClientId) {
    if (!iosClientId.endsWith('.apps.googleusercontent.com')) {
      throw new Error(
        'EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID must be a Google iOS OAuth client ID.'
      );
    }
    plugins.push([
      '@react-native-google-signin/google-signin',
      { iosUrlScheme: iosClientId.split('.').reverse().join('.') },
    ]);
  }
  return {
    ...config,
    name: config.name ?? appJson.expo.name,
    slug: config.slug ?? appJson.expo.slug,
    plugins,
  };
};
