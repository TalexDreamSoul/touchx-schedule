#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(TouchXNativeUX, NSObject)

RCT_EXTERN_METHOD(selection)
RCT_EXTERN_METHOD(impact:(NSString *)style)
RCT_EXTERN_METHOD(notification:(NSString *)type)
RCT_EXTERN_METHOD(requestNotificationPermission:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(scheduleEventNotifications:(NSArray *)events resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(updateSharedSchedule:(NSArray *)events resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(exportScheduleToSystemCalendar:(NSArray *)events resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(startLiveActivity:(NSDictionary *)event resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(endLiveActivity:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(setAuthenticated:(nonnull NSNumber *)authenticated)
RCT_EXTERN_METHOD(pushNativeScreen:(NSString *)screen title:(NSString *)title)

@end
