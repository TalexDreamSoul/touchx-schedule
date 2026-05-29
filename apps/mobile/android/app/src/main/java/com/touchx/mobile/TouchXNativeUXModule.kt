package com.touchx.mobile

import android.content.ContentValues
import android.provider.CalendarContract
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import java.time.Instant
import java.time.format.DateTimeParseException
import java.util.TimeZone

class TouchXNativeUXModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = "TouchXNativeUX"

  @ReactMethod
  fun selection() {
    // Android haptics are handled by RN Pressable feedback in this lightweight bridge.
  }

  @ReactMethod
  fun impact(style: String) {
    // No-op fallback keeps JS bridge parity with iOS.
  }

  @ReactMethod
  fun notification(type: String) {
    // No-op fallback keeps JS bridge parity with iOS.
  }

  @ReactMethod
  fun requestNotificationPermission(promise: Promise) {
    val result = Arguments.createMap()
    result.putBoolean("granted", true)
    result.putString("status", "platform_default")
    promise.resolve(result)
  }

  @ReactMethod
  fun scheduleEventNotifications(events: ReadableArray, promise: Promise) {
    val result = Arguments.createMap()
    result.putInt("scheduled", 0)
    result.putString("reason", "android_alarm_not_configured")
    promise.resolve(result)
  }

  @ReactMethod
  fun updateSharedSchedule(events: ReadableArray, promise: Promise) {
    val result = Arguments.createMap()
    result.putBoolean("saved", false)
    result.putInt("count", events.size())
    result.putString("reason", "android_widget_not_configured")
    promise.resolve(result)
  }

  @ReactMethod
  fun exportScheduleToSystemCalendar(events: ReadableArray, promise: Promise) {
    try {
      val calendarId = findWritableCalendarId()
      if (calendarId == null) {
        val result = Arguments.createMap()
        result.putInt("exported", 0)
        result.putInt("inserted", 0)
        result.putInt("skipped", events.size())
        result.putString("reason", "no_writable_calendar")
        promise.resolve(result)
        return
      }

      var inserted = 0
      var skipped = 0
      for (index in 0 until events.size()) {
        val item = events.getMap(index) ?: continue
        val id = item.stringValue("id") ?: "touchx-$index"
        if (existsTouchXEvent(id)) {
          skipped += 1
          continue
        }
        val start = item.stringValue("startAt")?.toEpochMillis() ?: continue
        val end = item.stringValue("endAt")?.toEpochMillis() ?: (start + 60 * 60 * 1000)
        val values = ContentValues().apply {
          put(CalendarContract.Events.CALENDAR_ID, calendarId)
          put(CalendarContract.Events.TITLE, item.stringValue("title") ?: "TouchX 日程")
          put(CalendarContract.Events.DESCRIPTION, listOfNotNull(item.stringValue("body"), "TouchX-ID: $id").joinToString("\n"))
          put(CalendarContract.Events.EVENT_LOCATION, item.stringValue("location") ?: "")
          put(CalendarContract.Events.DTSTART, start)
          put(CalendarContract.Events.DTEND, end)
          put(CalendarContract.Events.EVENT_TIMEZONE, TimeZone.getDefault().id)
        }
        val uri = reactContext.contentResolver.insert(CalendarContract.Events.CONTENT_URI, values)
        val eventId = uri?.lastPathSegment?.toLongOrNull()
        if (eventId == null) {
          skipped += 1
          continue
        }
        val offsets = item.getArray("offsetMinutes")
        if (offsets != null) {
          for (offsetIndex in 0 until offsets.size()) {
            val minutes = offsets.getInt(offsetIndex)
            val reminderValues = ContentValues().apply {
              put(CalendarContract.Reminders.EVENT_ID, eventId)
              put(CalendarContract.Reminders.MINUTES, minutes.coerceAtLeast(0))
              put(CalendarContract.Reminders.METHOD, CalendarContract.Reminders.METHOD_ALERT)
            }
            reactContext.contentResolver.insert(CalendarContract.Reminders.CONTENT_URI, reminderValues)
          }
        }
        inserted += 1
      }

      val result = Arguments.createMap()
      result.putInt("exported", inserted)
      result.putInt("inserted", inserted)
      result.putInt("skipped", skipped)
      promise.resolve(result)
    } catch (error: SecurityException) {
      val result = Arguments.createMap()
      result.putInt("exported", 0)
      result.putInt("inserted", 0)
      result.putInt("skipped", events.size())
      result.putString("reason", "calendar_permission_denied")
      promise.resolve(result)
    } catch (error: Exception) {
      promise.reject("CALENDAR_EXPORT_FAILED", error)
    }
  }

  @ReactMethod
  fun startLiveActivity(event: ReadableMap, promise: Promise) {
    val result = Arguments.createMap()
    result.putBoolean("started", false)
    result.putString("reason", "android_live_activity_not_supported")
    promise.resolve(result)
  }

  @ReactMethod
  fun endLiveActivity(promise: Promise) {
    val result = Arguments.createMap()
    result.putInt("ended", 0)
    promise.resolve(result)
  }

  @ReactMethod
  fun setAuthenticated(authenticated: Boolean) {
    // Auth state is currently consumed by JS on Android.
  }

  @ReactMethod
  fun pushNativeScreen(screen: String, title: String) {
    // Android navigation currently remains in React Native.
  }

  private fun findWritableCalendarId(): Long? {
    val projection = arrayOf(CalendarContract.Calendars._ID, CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL)
    reactContext.contentResolver.query(CalendarContract.Calendars.CONTENT_URI, projection, null, null, null)?.use { cursor ->
      while (cursor.moveToNext()) {
        val id = cursor.getLong(0)
        val access = cursor.getInt(1)
        if (access >= CalendarContract.Calendars.CAL_ACCESS_CONTRIBUTOR) return id
      }
    }
    return null
  }

  private fun existsTouchXEvent(id: String): Boolean {
    val projection = arrayOf(CalendarContract.Events._ID, CalendarContract.Events.DESCRIPTION)
    reactContext.contentResolver.query(CalendarContract.Events.CONTENT_URI, projection, null, null, null)?.use { cursor ->
      while (cursor.moveToNext()) {
        val description = cursor.getString(1) ?: continue
        if (description.contains("TouchX-ID: $id")) return true
      }
    }
    return false
  }
}

private fun ReadableMap.stringValue(key: String): String? = if (hasKey(key) && !isNull(key)) getString(key) else null

private fun String.toEpochMillis(): Long? = try {
  Instant.parse(this).toEpochMilli()
} catch (_: DateTimeParseException) {
  null
}
