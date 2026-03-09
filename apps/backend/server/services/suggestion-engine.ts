import type { SmartSuggestionItem } from "@touchx/shared";
import type { ScheduleEntryRecord, UserRecord } from "./domain-store";

export interface SuggestionContext {
  user: UserRecord;
  nextDayCourses: ScheduleEntryRecord[];
  hasRainWeather: boolean;
  hasLocation: boolean;
  longDistanceCourseCount: number;
}

const buildSuggestion = (
  code: string,
  title: string,
  content: string,
  priority: number,
  reasonCodes: string[],
): SmartSuggestionItem => ({
  code,
  title,
  content,
  priority,
  reasonCodes,
});

const scoreSuggestion = (item: SmartSuggestionItem) => {
  const reasonWeight = item.reasonCodes.length * 3;
  return item.priority * 10 + reasonWeight;
};

export const buildSmartSuggestions = (context: SuggestionContext) => {
  const suggestions: SmartSuggestionItem[] = [];
  const earlyCourses = context.nextDayCourses.filter((item) => item.startSection <= 2);
  const totalCourses = context.nextDayCourses.length;

  if (totalCourses === 0) {
    suggestions.push(
      buildSuggestion(
        "no_class_day",
        "明日无课",
        "明日无课程安排，建议安排复习、运动或社团活动。",
        9,
        ["NO_CLASS_DAY"],
      ),
    );
  } else {
    const firstCourse = [...context.nextDayCourses].sort((left, right) => left.startSection - right.startSection)[0];
    suggestions.push(
      buildSuggestion(
        "course_prepare",
        "次日准备",
        `明日共 ${totalCourses} 节课，建议今晚准备好课程资料与充电设备。`,
        8,
        ["NEXT_DAY_COURSE_SUMMARY"],
      ),
    );
    suggestions.push(
      buildSuggestion(
        "first_course_window",
        "首课出发窗口",
        `第一节《${firstCourse.courseName}》建议提前 25 分钟出发，避免迟到。`,
        7,
        ["FIRST_COURSE_TIME_WINDOW"],
      ),
    );
  }

  if (earlyCourses.length > 0) {
    suggestions.push(
      buildSuggestion(
        "early_class_sleep",
        "早课作息建议",
        "明天有早课，建议今晚提前 30 分钟入睡并设置双闹钟。",
        8,
        ["EARLY_CLASS"],
      ),
    );
  }

  if (context.longDistanceCourseCount > 0) {
    suggestions.push(
      buildSuggestion(
        "long_distance_course",
        "跨楼通勤提醒",
        "存在跨区域课程，建议预留额外通勤时间。",
        6,
        ["LONG_DISTANCE_COURSE"],
      ),
    );
  }

  if (context.hasRainWeather) {
    suggestions.push(
      buildSuggestion(
        "weather_rain",
        "天气提醒",
        "预计有降雨，建议携带雨具并为通勤增加缓冲。",
        7,
        ["RAINY_WEATHER"],
      ),
    );
  }

  if (!context.hasLocation) {
    suggestions.push(
      buildSuggestion(
        "location_missing",
        "位置状态提醒",
        "未检测到有效位置，商家距离将按估算展示。",
        5,
        ["LOCATION_STALE"],
      ),
    );
  }

  const deduped = new Map<string, SmartSuggestionItem>();
  suggestions.forEach((item) => {
    const existing = deduped.get(item.code);
    if (!existing || scoreSuggestion(item) > scoreSuggestion(existing)) {
      deduped.set(item.code, item);
    }
  });

  return [...deduped.values()].sort((left, right) => scoreSuggestion(right) - scoreSuggestion(left));
};
