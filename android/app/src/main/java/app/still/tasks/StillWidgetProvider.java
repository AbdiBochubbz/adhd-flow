package app.still.tasks;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.widget.RemoteViews;

public class StillWidgetProvider extends AppWidgetProvider {
    static final String PREFS = "StillWidget";
    static final String KEY_LINE = "line";
    static final String KEY_DETAIL = "detail";

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] appWidgetIds) {
        updateAll(context);
    }

    static void updateAll(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String line = prefs.getString(KEY_LINE, "Nothing is waiting");
        String detail = prefs.getString(KEY_DETAIL, "Add a task");
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.still_widget);
        views.setTextViewText(R.id.widget_line, line);
        views.setTextViewText(R.id.widget_detail, detail);
        views.setOnClickPendingIntent(R.id.widget_root, open(context, "still://open", 1));
        views.setOnClickPendingIntent(R.id.widget_add, open(context, "still://add", 2));
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        ComponentName widget = new ComponentName(context, StillWidgetProvider.class);
        manager.updateAppWidget(widget, views);
    }

    private static PendingIntent open(Context context, String url, int request) {
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        intent.setClass(context, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(
            context,
            request,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }
}
