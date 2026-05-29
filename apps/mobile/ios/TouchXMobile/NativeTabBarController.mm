#import "NativeTabBarController.h"

#import <React-RCTAppDelegate/RCTRootViewFactory.h>

static NSString *const TouchXAuthStateChangedNotificationName = @"TouchXAuthStateChanged";

@interface NativeTabBarController () <UITabBarControllerDelegate, UINavigationControllerDelegate>

@property (nonatomic, strong) RCTRootViewFactory *rootViewFactory;
@property (nonatomic, strong) UIViewController *loginViewController;
@property (nonatomic, strong) NSArray<UIViewController *> *mainViewControllers;
@property (nonatomic, assign) BOOL showingLogin;

@end

@implementation NativeTabBarController

- (instancetype)initWithRootViewFactory:(RCTRootViewFactory *)rootViewFactory
{
  if (self = [super init]) {
    _rootViewFactory = rootViewFactory;
    self.delegate = self;
    _showingLogin = YES;
    [self configureTabs];
    [[NSNotificationCenter defaultCenter] addObserver:self
                                             selector:@selector(authStateChanged:)
                                                 name:TouchXAuthStateChangedNotificationName
                                               object:nil];
  }
  return self;
}

- (void)viewDidLoad
{
  [super viewDidLoad];
  self.overrideUserInterfaceStyle = UIUserInterfaceStyleLight;
  self.edgesForExtendedLayout = UIRectEdgeAll;
  self.extendedLayoutIncludesOpaqueBars = YES;
  self.view.backgroundColor = [UIColor colorWithRed:0.953 green:0.957 blue:0.969 alpha:1.0];
  if (@available(iOS 11.0, *)) {
    self.view.insetsLayoutMarginsFromSafeArea = NO;
  }
  self.tabBar.translucent = YES;
  self.tabBar.hidden = self.showingLogin;
  self.tabBar.tintColor = [UIColor colorWithRed:0.067 green:0.067 blue:0.067 alpha:1.0];
  self.tabBar.unselectedItemTintColor = [UIColor colorWithRed:0.373 green:0.373 blue:0.373 alpha:1.0];
  self.tabBar.standardAppearance = [self makeTabBarAppearance];
  if (@available(iOS 15.0, *)) {
    self.tabBar.scrollEdgeAppearance = self.tabBar.standardAppearance;
  }
}

- (UITabBarAppearance *)makeTabBarAppearance
{
  UITabBarAppearance *appearance = [UITabBarAppearance new];
  [appearance configureWithTransparentBackground];
  appearance.backgroundEffect = [UIBlurEffect effectWithStyle:UIBlurEffectStyleSystemMaterialLight];
  appearance.backgroundColor = [UIColor colorWithWhite:1.0 alpha:0.86];
  appearance.shadowColor = [UIColor colorWithRed:0.839 green:0.851 blue:0.878 alpha:1.0];

  UIColor *normalColor = [UIColor colorWithRed:0.373 green:0.373 blue:0.373 alpha:1.0];
  UIColor *selectedColor = [UIColor colorWithRed:0.067 green:0.067 blue:0.067 alpha:1.0];
  UITabBarItemAppearance *itemAppearance = [UITabBarItemAppearance new];
  itemAppearance.normal.titleTextAttributes = @{ NSForegroundColorAttributeName : normalColor };
  itemAppearance.selected.titleTextAttributes = @{ NSForegroundColorAttributeName : selectedColor };
  itemAppearance.normal.iconColor = normalColor;
  itemAppearance.selected.iconColor = selectedColor;
  appearance.stackedLayoutAppearance = itemAppearance;
  appearance.inlineLayoutAppearance = itemAppearance;
  appearance.compactInlineLayoutAppearance = itemAppearance;

  return appearance;
}

- (void)viewDidLayoutSubviews
{
  [super viewDidLayoutSubviews];

  UIViewController *visibleController = self.selectedViewController;
  UIView *containerView = visibleController.view.superview;
  if (visibleController != nil && containerView != nil) {
    if (containerView != self.view) {
      containerView.frame = self.view.bounds;
      visibleController.view.frame = containerView.bounds;
    } else {
      visibleController.view.frame = self.view.bounds;
    }
  }
  [self.view bringSubviewToFront:self.tabBar];
}

- (void)configureEdgeToEdgeViewController:(UIViewController *)viewController
{
  viewController.edgesForExtendedLayout = UIRectEdgeAll;
  viewController.extendedLayoutIncludesOpaqueBars = YES;
  viewController.viewRespectsSystemMinimumLayoutMargins = NO;
  if (@available(iOS 11.0, *)) {
    viewController.view.insetsLayoutMarginsFromSafeArea = NO;
  }
}

- (void)configureTabs
{
  self.loginViewController = [self makeReactTabWithKey:@"login"
                                                 title:@"登录"
                                            systemIcon:@"person.crop.circle"];
  // Do not create the main React roots before authentication. This keeps the
  // logged-out entry truly full-screen and avoids background API calls/log spam.
  self.mainViewControllers = @[];
  self.viewControllers = @[ self.loginViewController ];
  self.tabBar.hidden = YES;
}

- (NSArray<UIViewController *> *)makeMainViewControllers
{
  UIViewController *today = [self makeReactTabWithKey:@"today"
                                                title:@"今日"
                                           systemIcon:@"calendar"];
  UIViewController *schedule = [self makeReactTabWithKey:@"schedule"
                                                   title:@"日程表"
                                              systemIcon:@"calendar.day.timeline.left"];
  UIViewController *profile = [self makeReactTabWithKey:@"profile"
                                                  title:@"我的"
                                             systemIcon:@"person.crop.circle"];
  return @[ today, schedule, profile ];
}

- (void)setInitialRootView:(UIView *)rootView
{
  UIViewController *login = self.loginViewController ?: self.viewControllers.firstObject;
  if (login == nil) {
    return;
  }
  rootView.backgroundColor = [UIColor colorWithRed:0.953 green:0.957 blue:0.969 alpha:1.0];
  UIViewController *target = login;
  if ([login isKindOfClass:[UINavigationController class]]) {
    target = ((UINavigationController *)login).viewControllers.firstObject ?: login;
  }
  target.view = rootView;
}

- (void)authStateChanged:(NSNotification *)notification
{
  BOOL authenticated = [notification.userInfo[@"authenticated"] boolValue];
  [self setAuthenticated:authenticated animated:YES];
}

- (void)setAuthenticated:(BOOL)authenticated animated:(BOOL)animated
{
  if (authenticated && self.showingLogin) {
    if (self.mainViewControllers.count == 0) {
      self.mainViewControllers = [self makeMainViewControllers];
    }
    self.showingLogin = NO;
    self.tabBar.hidden = NO;
    void (^changes)(void) = ^{
      self.viewControllers = self.mainViewControllers;
      self.selectedIndex = 0;
    };
    if (animated) {
      [UIView transitionWithView:self.view duration:0.32 options:UIViewAnimationOptionTransitionCrossDissolve animations:changes completion:nil];
    } else {
      changes();
    }
    return;
  }

  if (!authenticated && !self.showingLogin) {
    self.showingLogin = YES;
    void (^changes)(void) = ^{
      self.viewControllers = @[ self.loginViewController ];
      self.mainViewControllers = @[];
      self.tabBar.hidden = YES;
    };
    if (animated) {
      [UIView transitionWithView:self.view duration:0.28 options:UIViewAnimationOptionTransitionCrossDissolve animations:changes completion:nil];
    } else {
      changes();
    }
  }
}

- (BOOL)tabBarController:(UITabBarController *)tabBarController shouldSelectViewController:(UIViewController *)viewController
{
  if (viewController != self.selectedViewController) {
    UISelectionFeedbackGenerator *generator = [UISelectionFeedbackGenerator new];
    [generator prepare];
    [generator selectionChanged];
  }
  return YES;
}

- (void)tabBarController:(UITabBarController *)tabBarController didSelectViewController:(UIViewController *)viewController
{
  [UIView transitionWithView:viewController.view
                    duration:0.18
                     options:UIViewAnimationOptionTransitionCrossDissolve | UIViewAnimationOptionAllowAnimatedContent
                  animations:nil
                  completion:nil];
}

- (UIViewController *)makeReactTabWithKey:(NSString *)tabKey title:(NSString *)title systemIcon:(NSString *)systemIcon
{
  UIView *rootView;
  if ([tabKey isEqualToString:@"login"]) {
    rootView = [UIView new];
  } else {
    rootView = [self.rootViewFactory viewWithModuleName:@"TouchXMobile"
                                      initialProperties:@{
                                        @"tabKey" : tabKey,
                                        @"nativeTabBar" : @YES,
                                      }];
  }
  rootView.backgroundColor = [UIColor colorWithRed:0.953 green:0.957 blue:0.969 alpha:1.0];

  UIViewController *contentController = [UIViewController new];
  contentController.overrideUserInterfaceStyle = UIUserInterfaceStyleLight;
  contentController.view = rootView;
  contentController.title = title;
  [self configureEdgeToEdgeViewController:contentController];

  UINavigationController *navigationController = [[UINavigationController alloc] initWithRootViewController:contentController];
  navigationController.overrideUserInterfaceStyle = UIUserInterfaceStyleLight;
  navigationController.edgesForExtendedLayout = UIRectEdgeAll;
  navigationController.extendedLayoutIncludesOpaqueBars = YES;
  navigationController.delegate = self;
  navigationController.navigationBarHidden = YES;
  navigationController.navigationBar.translucent = YES;
  navigationController.navigationBar.prefersLargeTitles = YES;
  navigationController.navigationBar.standardAppearance = [self makeNavigationAppearance];
  navigationController.navigationBar.scrollEdgeAppearance = navigationController.navigationBar.standardAppearance;
  if (@available(iOS 15.0, *)) {
    navigationController.navigationBar.compactScrollEdgeAppearance = navigationController.navigationBar.standardAppearance;
  }
  if (@available(iOS 11.0, *)) {
    navigationController.view.insetsLayoutMarginsFromSafeArea = NO;
  }
  navigationController.tabBarItem = [[UITabBarItem alloc] initWithTitle:title
                                                                  image:[UIImage systemImageNamed:systemIcon]
                                                                    tag:0];
  return navigationController;
}

- (UINavigationBarAppearance *)makeNavigationAppearance
{
  UINavigationBarAppearance *appearance = [UINavigationBarAppearance new];
  [appearance configureWithTransparentBackground];
  appearance.backgroundEffect = [UIBlurEffect effectWithStyle:UIBlurEffectStyleSystemMaterialLight];
  appearance.backgroundColor = [UIColor colorWithWhite:1.0 alpha:0.88];
  appearance.shadowColor = [UIColor colorWithRed:0.839 green:0.851 blue:0.878 alpha:1.0];
  appearance.titleTextAttributes = @{ NSForegroundColorAttributeName : [UIColor colorWithRed:0.067 green:0.067 blue:0.067 alpha:1.0] };
  appearance.largeTitleTextAttributes = @{ NSForegroundColorAttributeName : [UIColor colorWithRed:0.067 green:0.067 blue:0.067 alpha:1.0] };
  return appearance;
}

- (void)pushNativeScreen:(NSString *)screen title:(NSString *)title
{
  UINavigationController *navigationController = (UINavigationController *)self.selectedViewController;
  if (![navigationController isKindOfClass:[UINavigationController class]]) {
    return;
  }

  UIView *rootView = [self.rootViewFactory viewWithModuleName:@"TouchXMobile"
                                            initialProperties:@{
                                              @"tabKey" : @"profile",
                                              @"nativeTabBar" : @YES,
                                              @"nativeStackScreen" : screen,
                                            }];
  rootView.backgroundColor = [UIColor colorWithRed:0.949 green:0.949 blue:0.969 alpha:1.0];

  UIViewController *viewController = [UIViewController new];
  viewController.overrideUserInterfaceStyle = UIUserInterfaceStyleLight;
  viewController.view = rootView;
  viewController.title = title ?: @"";
  viewController.navigationItem.largeTitleDisplayMode = UINavigationItemLargeTitleDisplayModeNever;
  [self configureEdgeToEdgeViewController:viewController];
  [navigationController setNavigationBarHidden:NO animated:YES];
  [navigationController pushViewController:viewController animated:YES];
}

- (void)navigationController:(UINavigationController *)navigationController
       didShowViewController:(UIViewController *)viewController
                    animated:(BOOL)animated
{
  [navigationController setNavigationBarHidden:navigationController.viewControllers.count <= 1 animated:animated];
}

- (void)dealloc
{
  [[NSNotificationCenter defaultCenter] removeObserver:self];
}

@end
