import UIKit

extension UIApplication {
  var touchXNativeTabBarController: NativeTabBarController? {
    connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap { $0.windows }
      .first { $0.isKeyWindow }?
      .rootViewController as? NativeTabBarController
  }
}
