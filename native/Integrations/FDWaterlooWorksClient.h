#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

typedef void (^FDWaterlooWorksCompletion)(NSDictionary *response);

/// Owns the bundled service. No endpoint, token, executable, or file path is
/// accepted from the renderer. Completions are delivered on the main queue.
@interface FDWaterlooWorksClient : NSObject
- (void)request:(NSDictionary *)payload completion:(FDWaterlooWorksCompletion)completion;
- (void)shutdown;
@end

NS_ASSUME_NONNULL_END
