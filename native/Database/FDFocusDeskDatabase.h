#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

typedef void (^FDFocusDeskDatabaseCompletion)(NSDictionary *response);

@interface FDFocusDeskDatabase : NSObject

- (void)invokeOperation:(NSString *)operation
                payload:(NSDictionary *)payload
             completion:(FDFocusDeskDatabaseCompletion)completion;

@end

NS_ASSUME_NONNULL_END
