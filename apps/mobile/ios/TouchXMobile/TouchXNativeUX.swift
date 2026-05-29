import ActivityKit
import EventKit
import Foundation
import React
import UIKit
import UserNotifications
import WidgetKit

let touchXAuthStateChangedNotification = Notification.Name("TouchXAuthStateChanged")
let touchXLoginRouteValue = "login"

private let touchXAppGroupIdentifier = "group.com.touchx.mobile"
private let touchXSharedScheduleKey = "touchx.shared.schedule.v1"

@objc(TouchXNativeUX)
final class TouchXNativeUX: NSObject {
  @objc
  static func requiresMainQueueSetup() -> Bool {
    true
  }

  @objc(selection)
  func selection() {
    DispatchQueue.main.async {
      let generator = UISelectionFeedbackGenerator()
      generator.prepare()
      generator.selectionChanged()
    }
  }

  @objc(impact:)
  func impact(_ style: NSString) {
    DispatchQueue.main.async {
      let generator = UIImpactFeedbackGenerator(style: TouchXNativeUX.impactStyle(from: style as String))
      generator.prepare()
      generator.impactOccurred()
    }
  }

  @objc(notification:)
  func notification(_ type: NSString) {
    DispatchQueue.main.async {
      let generator = UINotificationFeedbackGenerator()
      generator.prepare()
      generator.notificationOccurred(TouchXNativeUX.notificationType(from: type as String))
    }
  }

  @objc(requestNotificationPermission:rejecter:)
  func requestNotificationPermission(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    let center = UNUserNotificationCenter.current()
    center.requestAuthorization(options: [.alert, .badge, .sound]) { granted, error in
      if let error {
        reject("NOTIFICATION_PERMISSION_FAILED", error.localizedDescription, error)
        return
      }
      center.getNotificationSettings { settings in
        resolve([
          "granted": granted,
          "status": settings.authorizationStatus.rawValue,
        ])
      }
    }
  }

  @objc(scheduleEventNotifications:resolver:rejecter:)
  func scheduleEventNotifications(_ events: NSArray, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    let normalizedEvents = TouchXScheduleEvent.normalizeList(events)
    let center = UNUserNotificationCenter.current()
    let ids = normalizedEvents.flatMap { event in
      event.offsetMinutes.map { "touchx.schedule.\(event.id).\($0)" }
    }

    center.removePendingNotificationRequests(withIdentifiers: ids)

    var scheduled = 0
    let group = DispatchGroup()
    let now = Date()

    for event in normalizedEvents {
      for offset in event.offsetMinutes {
        let fireDate = event.startAt.addingTimeInterval(TimeInterval(-max(0, offset) * 60))
        if fireDate <= now { continue }

        let content = UNMutableNotificationContent()
        content.title = offset > 0 ? "\(offset) 分钟后开始：\(event.title)" : "日程即将开始：\(event.title)"
        content.body = event.body.isEmpty ? "打开 TouchX 查看详情" : event.body
        content.sound = .default
        content.threadIdentifier = "touchx.schedule"
        content.categoryIdentifier = "TOUCHX_SCHEDULE"
        content.userInfo = [
          "eventId": event.id,
          "eventTitle": event.title,
          "startAt": ISO8601DateFormatter.touchxFormatter.string(from: event.startAt),
        ]

        let components = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute, .second], from: fireDate)
        let trigger = UNCalendarNotificationTrigger(dateMatching: components, repeats: false)
        let request = UNNotificationRequest(identifier: "touchx.schedule.\(event.id).\(offset)", content: content, trigger: trigger)

        group.enter()
        center.add(request) { error in
          if error == nil { scheduled += 1 }
          group.leave()
        }
      }
    }

    group.notify(queue: .main) {
      UIApplication.shared.applicationIconBadgeNumber = min(scheduled, 99)
      resolve(["scheduled": scheduled])
    }
  }

  @objc(updateSharedSchedule:resolver:rejecter:)
  func updateSharedSchedule(_ events: NSArray, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    let normalizedEvents = TouchXScheduleEvent.normalizeList(events)
    let payload = normalizedEvents.prefix(30).map { $0.widgetDictionary }
    let defaults = UserDefaults(suiteName: touchXAppGroupIdentifier) ?? .standard
    defaults.set(payload, forKey: touchXSharedScheduleKey)
    defaults.set(Date().timeIntervalSince1970, forKey: "touchx.shared.schedule.updatedAt")
    defaults.synchronize()

    if #available(iOS 14.0, *) {
      WidgetCenter.shared.reloadAllTimelines()
    }

    resolve(["saved": true, "count": payload.count])
  }

  @objc(exportScheduleToSystemCalendar:resolver:rejecter:)
  func exportScheduleToSystemCalendar(_ events: NSArray, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    let normalizedEvents = TouchXScheduleEvent.normalizeList(events)
    let store = EKEventStore()
    let writeEvents = {
      let calendar = store.defaultCalendarForNewEvents
      var exported = 0
      var skipped = 0
      for event in normalizedEvents {
        let existingPredicate = store.predicateForEvents(withStart: event.startAt.addingTimeInterval(-60), end: event.endAt.addingTimeInterval(60), calendars: calendar.map { [$0] })
        let exists = store.events(matching: existingPredicate).contains { candidate in
          candidate.url?.absoluteString == "touchx://event/\(event.id)" || candidate.notes?.contains("TouchX-ID: \(event.id)") == true
        }
        if exists {
          skipped += 1
          continue
        }
        let ekEvent = EKEvent(eventStore: store)
        ekEvent.calendar = calendar
        ekEvent.title = event.title
        ekEvent.location = event.location
        ekEvent.notes = [event.body, "TouchX-ID: \(event.id)"].filter { !$0.isEmpty }.joined(separator: "\n")
        ekEvent.url = URL(string: "touchx://event/\(event.id)")
        ekEvent.startDate = event.startAt
        ekEvent.endDate = event.endAt
        ekEvent.alarms = event.offsetMinutes.map { EKAlarm(relativeOffset: TimeInterval(-max(0, $0) * 60)) }
        do {
          try store.save(ekEvent, span: .thisEvent, commit: false)
          exported += 1
        } catch {
          skipped += 1
        }
      }
      do {
        try store.commit()
        resolve(["exported": exported, "inserted": exported, "skipped": skipped])
      } catch {
        reject("CALENDAR_EXPORT_FAILED", error.localizedDescription, error)
      }
    }

    if #available(iOS 17.0, *) {
      store.requestWriteOnlyAccessToEvents { granted, error in
        if let error {
          reject("CALENDAR_PERMISSION_FAILED", error.localizedDescription, error)
          return
        }
        guard granted else {
          resolve(["exported": 0, "inserted": 0, "skipped": normalizedEvents.count, "reason": "permission_denied"])
          return
        }
        writeEvents()
      }
    } else {
      store.requestAccess(to: .event) { granted, error in
        if let error {
          reject("CALENDAR_PERMISSION_FAILED", error.localizedDescription, error)
          return
        }
        guard granted else {
          resolve(["exported": 0, "inserted": 0, "skipped": normalizedEvents.count, "reason": "permission_denied"])
          return
        }
        writeEvents()
      }
    }
  }

  @objc(startLiveActivity:resolver:rejecter:)
  func startLiveActivity(_ eventObject: NSDictionary, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard #available(iOS 16.1, *) else {
      resolve(["started": false, "reason": "unsupported_ios"])
      return
    }
    guard ActivityAuthorizationInfo().areActivitiesEnabled else {
      resolve(["started": false, "reason": "disabled"])
      return
    }
    guard let event = TouchXScheduleEvent(dictionary: eventObject) else {
      resolve(["started": false, "reason": "invalid_event"])
      return
    }

    Task {
      for activity in Activity<TouchXScheduleActivityAttributes>.activities {
        if #available(iOS 16.2, *) {
          await activity.end(nil, dismissalPolicy: .immediate)
        } else {
          await activity.end(dismissalPolicy: .immediate)
        }
      }

      let attributes = TouchXScheduleActivityAttributes(
        eventId: event.id,
        title: event.title,
        location: event.location,
        timeText: event.timeText,
        colorHex: event.color
      )
      let state = TouchXScheduleActivityAttributes.ContentState(
        startAt: event.startAt,
        endAt: event.endAt,
        statusText: "即将开始"
      )

      do {
        let activity: Activity<TouchXScheduleActivityAttributes>
        if #available(iOS 16.2, *) {
          activity = try Activity.request(
            attributes: attributes,
            content: ActivityContent(state: state, staleDate: event.endAt),
            pushType: nil
          )
        } else {
          activity = try Activity.request(attributes: attributes, contentState: state, pushType: nil)
        }
        resolve(["started": true, "id": activity.id])
      } catch {
        resolve(["started": false, "reason": error.localizedDescription])
      }
    }
  }

  @objc(endLiveActivity:rejecter:)
  func endLiveActivity(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard #available(iOS 16.1, *) else {
      resolve(["ended": 0])
      return
    }
    Task {
      var count = 0
      for activity in Activity<TouchXScheduleActivityAttributes>.activities {
        if #available(iOS 16.2, *) {
          await activity.end(nil, dismissalPolicy: .immediate)
        } else {
          await activity.end(dismissalPolicy: .immediate)
        }
        count += 1
      }
      resolve(["ended": count])
    }
  }

  @objc(setAuthenticated:)
  func setAuthenticated(_ authenticated: NSNumber) {
    DispatchQueue.main.async {
      NotificationCenter.default.post(name: touchXAuthStateChangedNotification, object: nil, userInfo: [
        "authenticated": authenticated.boolValue,
      ])
    }
  }

  @objc(pushNativeScreen:title:)
  func pushNativeScreen(_ screen: NSString, title: NSString) {
    DispatchQueue.main.async {
      guard let tabBar = UIApplication.shared.touchXNativeTabBarController else { return }
      tabBar.pushNativeScreen(screen as String, title: title as String)
    }
  }

  private static func impactStyle(from value: String) -> UIImpactFeedbackGenerator.FeedbackStyle {
    switch value {
    case "medium": return .medium
    case "heavy": return .heavy
    case "soft":
      if #available(iOS 13.0, *) { return .soft }
      return .light
    case "rigid":
      if #available(iOS 13.0, *) { return .rigid }
      return .medium
    default: return .light
    }
  }

  private static func notificationType(from value: String) -> UINotificationFeedbackGenerator.FeedbackType {
    switch value {
    case "warning": return .warning
    case "error": return .error
    default: return .success
    }
  }
}

private struct TouchXScheduleEvent {
  let id: String
  let title: String
  let body: String
  let location: String
  let eventType: String
  let color: String
  let startAt: Date
  let endAt: Date
  let timeText: String
  let offsetMinutes: [Int]

  init?(dictionary: NSDictionary) {
    guard let rawStart = dictionary["startAt"] as? String,
          let startAt = ISO8601DateFormatter.touchxFormatter.date(from: rawStart) else {
      return nil
    }
    let rawEnd = dictionary["endAt"] as? String
    let endAt = rawEnd.flatMap { ISO8601DateFormatter.touchxFormatter.date(from: $0) } ?? startAt.addingTimeInterval(45 * 60)
    let rawOffsets = dictionary["offsetMinutes"] as? [Any] ?? [15, 5]
    let offsets = rawOffsets.compactMap { value -> Int? in
      if let number = value as? NSNumber { return number.intValue }
      if let string = value as? String { return Int(string) }
      return nil
    }

    self.id = TouchXScheduleEvent.safeIdentifier(String(describing: dictionary["id"] ?? UUID().uuidString))
    self.title = String(describing: dictionary["title"] ?? "未命名日程")
    self.body = String(describing: dictionary["body"] ?? "")
    self.location = String(describing: dictionary["location"] ?? "")
    self.eventType = String(describing: dictionary["eventType"] ?? "custom")
    self.color = String(describing: dictionary["color"] ?? "#2f55c8")
    self.startAt = startAt
    self.endAt = endAt
    self.timeText = String(describing: dictionary["timeText"] ?? "")
    self.offsetMinutes = offsets.isEmpty ? [15, 5] : offsets
  }

  var widgetDictionary: [String: Any] {
    [
      "id": id,
      "title": title,
      "body": body,
      "location": location,
      "eventType": eventType,
      "color": color,
      "startAt": ISO8601DateFormatter.touchxFormatter.string(from: startAt),
      "endAt": ISO8601DateFormatter.touchxFormatter.string(from: endAt),
      "timeText": timeText,
    ]
  }

  static func normalizeList(_ rawEvents: NSArray) -> [TouchXScheduleEvent] {
    rawEvents.compactMap { item in
      if let dictionary = item as? NSDictionary {
        return TouchXScheduleEvent(dictionary: dictionary)
      }
      return nil
    }.sorted { $0.startAt < $1.startAt }
  }

  private static func safeIdentifier(_ raw: String) -> String {
    let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_."))
    let scalars = raw.unicodeScalars.map { allowed.contains($0) ? Character($0) : "-" }
    let value = String(scalars).trimmingCharacters(in: CharacterSet(charactersIn: "-_."))
    return value.isEmpty ? UUID().uuidString : value
  }
}

extension ISO8601DateFormatter {
  static let touchxFormatter: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
  }()
}
