import './src/services/backgroundLocation'; // registers the background location task
import 'expo-router/entry';
import { Platform } from 'react-native';

// Android home-screen widget handler (react-native-android-widget). iOS widgets need a
// native WidgetKit extension and are not included in this version.
if (Platform.OS === 'android') {
  const { registerWidgetTaskHandler } = require('react-native-android-widget');
  const { widgetTaskHandler } = require('./src/widgets/taskHandler');
  registerWidgetTaskHandler(widgetTaskHandler);
}
