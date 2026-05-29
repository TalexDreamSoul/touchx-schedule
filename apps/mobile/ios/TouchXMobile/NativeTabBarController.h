#import <UIKit/UIKit.h>

@class RCTRootViewFactory;

@interface NativeTabBarController : UITabBarController

- (instancetype)initWithRootViewFactory:(RCTRootViewFactory *)rootViewFactory;
- (void)setInitialRootView:(UIView *)rootView;
- (void)setAuthenticated:(BOOL)authenticated animated:(BOOL)animated;
- (void)pushNativeScreen:(NSString *)screen title:(NSString *)title;

@end
