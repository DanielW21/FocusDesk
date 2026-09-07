#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

typedef void (^FDGoogleCalendarCompletion)(NSDictionary *response);

@interface FDGoogleCalendarClient : NSObject

- (void)invokeOperation:(NSString *)operation
                payload:(NSDictionary *)payload
             completion:(FDGoogleCalendarCompletion)completion;

@end

NS_ASSUME_NONNULL_END
