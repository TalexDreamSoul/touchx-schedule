import ActivityKit
import Foundation

@available(iOS 16.1, *)
struct TouchXScheduleActivityAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    var startAt: Date
    var endAt: Date
    var statusText: String
  }

  var eventId: String
  var title: String
  var location: String
  var timeText: String
  var colorHex: String
}
