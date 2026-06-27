package com.vyact.consumer;

import android.app.Activity;
import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.view.View;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

// Shown when the large (budget) widget is added: lets the user pick which
// household's budget the widget tracks. Households come from widget.households
// (written by widgets.ts); the choice is stored per widget id.
public class BudgetWidgetConfigActivity extends Activity {

  private int appWidgetId = AppWidgetManager.INVALID_APPWIDGET_ID;

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    setResult(RESULT_CANCELED); // back-out leaves the widget unplaced
    setContentView(R.layout.activity_budget_config);

    Bundle extras = getIntent().getExtras();
    if (extras != null) {
      appWidgetId = extras.getInt(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
    }
    if (appWidgetId == AppWidgetManager.INVALID_APPWIDGET_ID) { finish(); return; }

    LinearLayout list = findViewById(R.id.cfg_list);
    SharedPreferences cap = getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE);
    String json = cap.getString("widget.households", "[]");
    boolean added = false;
    try {
      JSONArray arr = new JSONArray(json);
      for (int i = 0; i < arr.length(); i++) {
        JSONObject o = arr.getJSONObject(i);
        addRow(list, o.optString("id"), o.optString("name", "Household"));
        added = true;
      }
    } catch (Exception ignored) {}
    if (!added) addRow(list, cap.getString("widget.currentHid", ""), "This device");
  }

  private void addRow(LinearLayout list, final String hid, String name) {
    TextView row = (TextView) getLayoutInflater().inflate(R.layout.budget_config_row, list, false);
    row.setText(name);
    row.setOnClickListener(new View.OnClickListener() {
      @Override public void onClick(View v) { choose(hid); }
    });
    list.addView(row);
  }

  private void choose(String hid) {
    getSharedPreferences("vyact_widgets", Context.MODE_PRIVATE)
        .edit().putString("hid_" + appWidgetId, hid).apply();
    AppWidgetManager mgr = AppWidgetManager.getInstance(this);
    BudgetWidgetProvider.render(this, mgr, appWidgetId);
    Intent result = new Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId);
    setResult(RESULT_OK, result);
    finish();
  }
}
