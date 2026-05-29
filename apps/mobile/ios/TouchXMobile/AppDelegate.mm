#import "AppDelegate.h"
#import "NativeTabBarController.h"

#import <React/RCTBundleURLProvider.h>

static NSString *const TouchXMobileSessionTokenKey = @"touchx_mobile_session_token_v1";

static NSString *TouchXPackagerHostPort(void)
{
#if TARGET_OS_SIMULATOR
  return @"localhost:8081";
#else
  NSString *ipPath = [[NSBundle mainBundle] pathForResource:@"ip" ofType:@"txt"];
  if (ipPath.length > 0) {
    NSString *host = [[NSString stringWithContentsOfFile:ipPath
                                                encoding:NSUTF8StringEncoding
                                                   error:nil] stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
    if (host.length > 0) {
      return [host containsString:@":"] ? host : [NSString stringWithFormat:@"%@:8081", host];
    }
  }
  return nil;
#endif
}

@interface AppDelegate ()

@property (nonatomic, strong) NativeTabBarController *nativeTabBarController;

@end

@implementation AppDelegate

- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)launchOptions
{
  self.moduleName = @"TouchXMobile";
  // You can add your custom initial props in the dictionary below.
  // They will be passed down to the ViewController used by React Native.
  self.initialProps = @{
    @"tabKey" : @"login",
    @"nativeTabBar" : @YES,
  };

  return [super application:application didFinishLaunchingWithOptions:launchOptions];
}

- (UIViewController *)createRootViewController
{
  self.nativeTabBarController = [[NativeTabBarController alloc] initWithRootViewFactory:self.rootViewFactory];
  return self.nativeTabBarController;
}

- (void)setRootView:(UIView *)rootView toRootViewController:(UIViewController *)rootViewController
{
  if ([rootViewController isKindOfClass:[NativeTabBarController class]]) {
    NativeTabBarController *tabBarController = (NativeTabBarController *)rootViewController;
    [tabBarController setInitialRootView:rootView];
    NSString *token = [[[NSUserDefaults standardUserDefaults] stringForKey:TouchXMobileSessionTokenKey] stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
    [tabBarController setAuthenticated:token.length > 0 animated:NO];
    [rootViewController setOverrideUserInterfaceStyle:UIUserInterfaceStyleLight];
  }
}

- (NSURL *)sourceURLForBridge:(RCTBridge *)bridge
{
  return [self bundleURL];
}

- (NSURL *)bundleURL
{
#if DEBUG
  NSURL *embeddedBundleURL = [[NSBundle mainBundle] URLForResource:@"main" withExtension:@"jsbundle"];
  NSString *hostPort = TouchXPackagerHostPort();
  if (hostPort.length > 0 && [RCTBundleURLProvider isPackagerRunning:hostPort]) {
    return [RCTBundleURLProvider jsBundleURLForBundleRoot:@"index"
                                             packagerHost:hostPort
                                                enableDev:YES
                                       enableMinification:NO
                                          inlineSourceMap:NO];
  }
  if (embeddedBundleURL != nil) {
    return embeddedBundleURL;
  }
  return [[RCTBundleURLProvider sharedSettings] jsBundleURLForBundleRoot:@"index" fallbackExtension:@"jsbundle"];
#else
  return [[NSBundle mainBundle] URLForResource:@"main" withExtension:@"jsbundle"];
#endif
}

@end
