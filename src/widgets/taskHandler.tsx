import React from 'react';
import type { WidgetTaskHandlerProps } from 'react-native-android-widget';
import { ScooterWidget } from './ScooterWidget';
import { loadWidgetData } from './widgetData';

/** Runs headless when Android asks the widget to render (added, periodic update, resize). */
export async function widgetTaskHandler(props: WidgetTaskHandlerProps) {
  if (props.widgetAction === 'WIDGET_DELETED') return;
  const data = await loadWidgetData();
  props.renderWidget(<ScooterWidget data={data} />);
}
