#import <Foundation/Foundation.h>
#import <WebKit/WebKit.h>

NS_ASSUME_NONNULL_BEGIN

@interface FDMessageBridge : NSObject <WKScriptMessageHandlerWithReply>

+ (NSString *)userScriptSource;

@end


NS_ASSUME_NONNULL_END
