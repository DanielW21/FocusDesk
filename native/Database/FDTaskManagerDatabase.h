#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

typedef void (^FDTaskManagerDatabaseCompletion)(NSDictionary *response);

@interface FDTaskManagerDatabase : NSObject

- (void)invokeOperation:(NSString *)operation
                payload:(NSDictionary *)payload
             completion:(FDTaskManagerDatabaseCompletion)completion;

@end

NS_ASSUME_NONNULL_END
