import ActivityKit
import SwiftUI
import WidgetKit

private let touchXAppGroupIdentifier = "group.com.touchx.mobile"
private let touchXSharedScheduleKey = "touchx.shared.schedule.v1"

struct TouchXWidgetScheduleEvent: Identifiable {
  let id: String
  let title: String
  let body: String
  let location: String
  let eventType: String
  let color: Color
  let startAt: Date
  let endAt: Date
  let timeText: String

  init?(dictionary: [String: Any]) {
    guard let startText = dictionary["startAt"] as? String,
          let startAt = ISO8601DateFormatter.touchxFormatter.date(from: startText) else {
      return nil
    }
    let endText = dictionary["endAt"] as? String
    self.id = String(describing: dictionary["id"] ?? UUID().uuidString)
    self.title = String(describing: dictionary["title"] ?? "未命名日程")
    self.body = String(describing: dictionary["body"] ?? "")
    self.location = String(describing: dictionary["location"] ?? "")
    self.eventType = String(describing: dictionary["eventType"] ?? "custom")
    self.color = Color(hex: String(describing: dictionary["color"] ?? "#2f55c8"))
    self.startAt = startAt
    self.endAt = endText.flatMap { ISO8601DateFormatter.touchxFormatter.date(from: $0) } ?? startAt.addingTimeInterval(45 * 60)
    self.timeText = String(describing: dictionary["timeText"] ?? "")
  }
}

struct TouchXScheduleEntry: TimelineEntry {
  let date: Date
  let events: [TouchXWidgetScheduleEvent]
}

struct TouchXScheduleProvider: TimelineProvider {
  func placeholder(in context: Context) -> TouchXScheduleEntry {
    TouchXScheduleEntry(date: Date(), events: [
      TouchXWidgetScheduleEvent.sample(title: "高等数学", minutesFromNow: 15),
      TouchXWidgetScheduleEvent.sample(title: "数据结构", minutesFromNow: 120),
    ])
  }

  func getSnapshot(in context: Context, completion: @escaping (TouchXScheduleEntry) -> Void) {
    completion(TouchXScheduleEntry(date: Date(), events: Self.loadEvents()))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<TouchXScheduleEntry>) -> Void) {
    let events = Self.loadEvents()
    let nextRefresh = events.first(where: { $0.startAt > Date() })?.startAt.addingTimeInterval(60) ?? Date().addingTimeInterval(30 * 60)
    completion(Timeline(entries: [TouchXScheduleEntry(date: Date(), events: events)], policy: .after(nextRefresh)))
  }

  private static func loadEvents() -> [TouchXWidgetScheduleEvent] {
    let defaults = UserDefaults(suiteName: touchXAppGroupIdentifier) ?? .standard
    let rawItems = defaults.array(forKey: touchXSharedScheduleKey) as? [[String: Any]] ?? []
    let now = Date().addingTimeInterval(-10 * 60)
    return rawItems
      .compactMap { TouchXWidgetScheduleEvent(dictionary: $0) }
      .filter { $0.endAt > now }
      .sorted { $0.startAt < $1.startAt }
  }
}

struct TouchXScheduleWidgetView: View {
  let entry: TouchXScheduleEntry

  var body: some View {
    let events = Array(entry.events.prefix(3))
    VStack(alignment: .leading, spacing: 10) {
      HStack(alignment: .center) {
        Text("TouchX 日程")
          .font(.headline.weight(.bold))
        Spacer()
        Text(Date(), style: .time)
          .font(.caption2.weight(.semibold))
          .foregroundStyle(.secondary)
      }

      if events.isEmpty {
        Spacer(minLength: 6)
        VStack(alignment: .leading, spacing: 6) {
          Text("暂无即将开始的日程")
            .font(.subheadline.weight(.bold))
          Text("打开 App 同步课程、Todo 与订阅")
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        Spacer(minLength: 6)
      } else {
        ForEach(events) { event in
          HStack(alignment: .top, spacing: 8) {
            RoundedRectangle(cornerRadius: 3)
              .fill(event.color)
              .frame(width: 4, height: 34)
            VStack(alignment: .leading, spacing: 2) {
              Text(event.title)
                .font(.subheadline.weight(.bold))
                .lineLimit(1)
              Text(event.timeText.isEmpty ? event.body : event.timeText)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            }
            Spacer(minLength: 4)
            Text(relativeText(for: event.startAt))
              .font(.caption2.weight(.bold))
              .foregroundStyle(event.color)
          }
        }
      }
    }
    .padding(14)
    .background(Color(UIColor.secondarySystemBackground))
  }

  private func relativeText(for date: Date) -> String {
    let minutes = Int(date.timeIntervalSinceNow / 60)
    if minutes <= 0 { return "进行中" }
    if minutes < 60 { return "\(minutes) 分钟" }
    return "\(minutes / 60) 小时"
  }
}

@main
struct TouchXScheduleWidgetBundle: WidgetBundle {
  var body: some Widget {
    TouchXScheduleWidget()
    TouchXScheduleLiveActivityWidget()
  }
}

struct TouchXScheduleWidget: Widget {
  let kind = "TouchXScheduleWidget"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: TouchXScheduleProvider()) { entry in
      TouchXScheduleWidgetView(entry: entry)
    }
    .configurationDisplayName("TouchX 日程")
    .description("查看即将开始的课程、Todo 和订阅日程。")
    .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular])
  }
}

struct TouchXScheduleLiveActivityWidget: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: TouchXScheduleActivityAttributes.self) { context in
      TouchXLiveActivityLockScreenView(context: context)
        .activityBackgroundTint(.white)
        .activitySystemActionForegroundColor(Color(hex: context.attributes.colorHex))
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          VStack(alignment: .leading, spacing: 3) {
            Text("TouchX")
              .font(.system(size: 10, weight: .semibold, design: .rounded))
              .foregroundStyle(.white.opacity(0.66))
              .lineLimit(1)

            Text(context.attributes.title)
              .font(.system(size: 16, weight: .heavy, design: .rounded))
              .foregroundStyle(.white)
              .lineLimit(1)
              .minimumScaleFactor(0.76)
          }
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(.leading, 2)
        }
        DynamicIslandExpandedRegion(.trailing) {
          Text(countdownText(to: context.state.startAt))
            .font(.system(size: 12, weight: .heavy, design: .rounded))
            .monospacedDigit()
            .foregroundStyle(readableAccent(hex: context.attributes.colorHex))
            .lineLimit(1)
            .minimumScaleFactor(0.68)
            .frame(maxWidth: 74, alignment: .trailing)
        }
        DynamicIslandExpandedRegion(.bottom) {
          HStack(spacing: 6) {
            Image(systemName: "mappin.and.ellipse")
              .font(.system(size: 11, weight: .bold, design: .rounded))
              .foregroundStyle(.white.opacity(0.72))
            Text(context.attributes.location.isEmpty ? "地点待定" : context.attributes.location)
              .lineLimit(1)
              .minimumScaleFactor(0.78)
            Spacer(minLength: 8)
            Text(context.attributes.timeText)
              .lineLimit(1)
              .minimumScaleFactor(0.78)
              .monospacedDigit()
          }
          .font(.system(size: 12, weight: .semibold, design: .rounded))
          .foregroundStyle(.white.opacity(0.72))
        }
      } compactLeading: {
        Text("TX")
          .font(.system(size: 10, weight: .heavy, design: .rounded))
          .foregroundStyle(.white)
          .lineLimit(1)
          .minimumScaleFactor(0.8)
      } compactTrailing: {
        Text(shortCountdownText(to: context.state.startAt))
          .font(.system(size: 11, weight: .heavy, design: .rounded))
          .monospacedDigit()
          .foregroundStyle(readableAccent(hex: context.attributes.colorHex))
          .lineLimit(1)
          .minimumScaleFactor(0.66)
          .frame(maxWidth: 36, alignment: .trailing)
      } minimal: {
        Text("T")
          .font(.system(size: 11, weight: .heavy, design: .rounded))
          .foregroundStyle(readableAccent(hex: context.attributes.colorHex))
      }
      .keylineTint(readableAccent(hex: context.attributes.colorHex))
    }
  }
}

struct TouchXLiveActivityLockScreenView: View {
  let context: ActivityViewContext<TouchXScheduleActivityAttributes>

  var body: some View {
    HStack(spacing: 12) {
      Circle()
        .fill(Color(hex: context.attributes.colorHex))
        .frame(width: 12, height: 12)
      VStack(alignment: .leading, spacing: 4) {
        Text(context.attributes.title)
          .font(.headline.weight(.bold))
          .lineLimit(1)
        Text("\(context.attributes.timeText) · \(context.attributes.location.isEmpty ? "地点待定" : context.attributes.location)")
          .font(.caption)
          .foregroundStyle(.secondary)
          .lineLimit(1)
      }
      Spacer()
      Text(countdownText(to: context.state.startAt))
        .font(.caption.weight(.bold))
        .foregroundStyle(Color(hex: context.attributes.colorHex))
    }
    .padding()
  }
}

private func countdownText(to date: Date) -> String {
  let minutes = Int(ceil(date.timeIntervalSinceNow / 60))
  if minutes <= 0 { return "进行中" }
  if minutes < 60 { return "\(minutes)分钟后" }
  return "\(minutes / 60)小时后"
}

private func shortCountdownText(to date: Date) -> String {
  let minutes = Int(ceil(date.timeIntervalSinceNow / 60))
  if minutes <= 0 { return "Now" }
  if minutes < 60 { return "\(minutes)m" }
  return "\(minutes / 60)h" }

private func readableAccent(hex: String) -> Color {
  let rgb = RGBColor(hex: hex)
  let luminance = 0.2126 * rgb.red + 0.7152 * rgb.green + 0.0722 * rgb.blue
  if luminance < 0.42 {
    return Color(red: min(1, rgb.red + 0.28), green: min(1, rgb.green + 0.28), blue: min(1, rgb.blue + 0.28))
  }
  return Color(red: rgb.red, green: rgb.green, blue: rgb.blue)
}

extension TouchXWidgetScheduleEvent {
  static func sample(title: String, minutesFromNow: Int) -> TouchXWidgetScheduleEvent {
    let startAt = Date().addingTimeInterval(TimeInterval(minutesFromNow * 60))
    let endAt = startAt.addingTimeInterval(45 * 60)
    return TouchXWidgetScheduleEvent(dictionary: [
      "id": UUID().uuidString,
      "title": title,
      "body": "示例日程",
      "location": "教学楼 A101",
      "eventType": "course",
      "color": "#2f55c8",
      "startAt": ISO8601DateFormatter.touchxFormatter.string(from: startAt),
      "endAt": ISO8601DateFormatter.touchxFormatter.string(from: endAt),
      "timeText": "\(Self.timeFormatter.string(from: startAt))-\(Self.timeFormatter.string(from: endAt))",
    ])!
  }

  private static let timeFormatter: DateFormatter = {
    let formatter = DateFormatter()
    formatter.dateFormat = "HH:mm"
    return formatter
  }()
}

extension ISO8601DateFormatter {
  static let touchxFormatter: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
  }()
}

private struct RGBColor {
  let red: Double
  let green: Double
  let blue: Double

  init(hex: String) {
    let raw = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
    var value: UInt64 = 0
    Scanner(string: raw).scanHexInt64(&value)
    if raw.count == 6 {
      red = Double((value & 0xFF0000) >> 16) / 255.0
      green = Double((value & 0x00FF00) >> 8) / 255.0
      blue = Double(value & 0x0000FF) / 255.0
    } else {
      red = 47.0 / 255.0
      green = 85.0 / 255.0
      blue = 200.0 / 255.0
    }
  }
}

extension Color {
  init(hex: String) {
    let rgb = RGBColor(hex: hex)
    self.init(red: rgb.red, green: rgb.green, blue: rgb.blue)
  }
}
