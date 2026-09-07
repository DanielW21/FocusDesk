#import "FDMessageBridge.h"

#import <Cocoa/Cocoa.h>
#import "../Database/FDFocusDeskDatabase.h"
#import "../Database/FDTaskManagerDatabase.h"
#import "../Integrations/FDGoogleCalendarClient.h"
#import "../Integrations/FDWaterlooWorksClient.h"

static NSString *const FDNativeBridgeVersion = @"1";

@interface FDMessageBridge ()
@property (strong) FDFocusDeskDatabase *focusDeskDatabase;
@property (strong) FDTaskManagerDatabase *taskManagerDatabase;
@property (strong) FDGoogleCalendarClient *googleCalendarClient;
@property (strong) FDWaterlooWorksClient *waterlooWorksClient;
@end

@implementation FDMessageBridge

- (instancetype)init {
    self = [super init];
    if (self) {
        _focusDeskDatabase = [FDFocusDeskDatabase new];
        _taskManagerDatabase = [FDTaskManagerDatabase new];
        _googleCalendarClient = [FDGoogleCalendarClient new];
        _waterlooWorksClient = [FDWaterlooWorksClient new];
    }
    return self;
}

+ (NSString *)userScriptSource {
    return @"(() => {"
        "const handler = window.webkit.messageHandlers.focusDesk;"
        "const nextId = () => globalThis.crypto?.randomUUID?.() ?? `fd-${Date.now()}-${Math.random()}`;"
        "const invoke = async (action, payload = {}) => {"
            "const id = nextId();"
            "const response = await handler.postMessage({ id, action, payload });"
            "if (!response || response.ok !== true) {"
                "const details = response?.error ?? { code: 'NATIVE_BRIDGE_ERROR', message: 'The native bridge returned an invalid response.' };"
                "const error = new Error(details.message);"
                "error.code = details.code;"
                "throw error;"
            "}"
            "return response.data;"
        "};"
        "window.focusDesk = {"
            "invoke,"
            "openLink: value => invoke('system.openLink', { value })"
        "};"
    "})();";
}

- (void)userContentController:(WKUserContentController *)userContentController
      didReceiveScriptMessage:(WKScriptMessage *)message
                  replyHandler:(void (^)(id _Nullable reply, NSString * _Nullable errorMessage))replyHandler {
    if (![message.name isEqualToString:@"focusDesk"] || ![message.body isKindOfClass:[NSDictionary class]]) {
        replyHandler([self errorResponseWithId:@"unknown"
                                          code:@"INVALID_REQUEST"
                                       message:@"The native bridge request must be an object."], nil);
        return;
    }

    NSDictionary *request = (NSDictionary *)message.body;
    NSString *requestId = [request[@"id"] isKindOfClass:[NSString class]] ? request[@"id"] : @"unknown";
    NSString *action = [request[@"action"] isKindOfClass:[NSString class]] ? request[@"action"] : nil;
    NSDictionary *payload = [request[@"payload"] isKindOfClass:[NSDictionary class]] ? request[@"payload"] : @{};

    if (action.length == 0) {
        replyHandler([self errorResponseWithId:requestId
                                          code:@"INVALID_ACTION"
                                       message:@"A named native action is required."], nil);
        return;
    }

    if ([action isEqualToString:@"system.health"]) {
        NSString *appVersion = [[NSBundle mainBundle] objectForInfoDictionaryKey:@"CFBundleShortVersionString"] ?: @"unknown";
        replyHandler(@{
            @"id": requestId,
            @"ok": @YES,
            @"data": @{
                @"bridgeVersion": FDNativeBridgeVersion,
                @"appVersion": appVersion,
                @"platform": @"macOS"
            }
        }, nil);
        return;
    }

    if ([action isEqualToString:@"system.openLink"]) {
        NSString *value = [payload[@"value"] isKindOfClass:[NSString class]] ? payload[@"value"] : nil;
        NSString *errorMessage = nil;
        BOOL opened = [self openValue:value errorMessage:&errorMessage];
        if (!opened) {
            replyHandler([self errorResponseWithId:requestId
                                              code:@"INVALID_LINK"
                                           message:errorMessage ?: @"The link could not be opened."], nil);
            return;
        }
        replyHandler(@{ @"id": requestId, @"ok": @YES, @"data": @{ @"opened": @YES } }, nil);
        return;
    }

    if ([action hasPrefix:@"googleCalendar."]) {
        NSString *operation = [action substringFromIndex:@"googleCalendar.".length];
        [self.googleCalendarClient invokeOperation:operation payload:payload completion:^(NSDictionary *response) {
            if ([response[@"ok"] boolValue]) {
                replyHandler(@{
                    @"id": requestId,
                    @"ok": @YES,
                    @"data": response[@"data"] ?: @{},
                }, nil);
                return;
            }
            replyHandler(@{
                @"id": requestId,
                @"ok": @NO,
                @"error": response[@"error"] ?: @{
                    @"code": @"GOOGLE_CALENDAR_ERROR",
                    @"message": @"Google Calendar integration failed.",
                },
            }, nil);
        }];
        return;
    }

    if ([action isEqualToString:@"waterlooworks.request"] ||
        [action isEqualToString:@"waterlooworks.config.status"] ||
        [action isEqualToString:@"waterlooworks.config.save"]) {
        NSURL *resourceRoot = [[[NSBundle mainBundle] resourceURL] URLByAppendingPathComponent:@"web" isDirectory:YES];
        NSURL *frameURL = message.frameInfo.request.URL;
        NSString *trustedPrefix = [resourceRoot.URLByResolvingSymlinksInPath.path stringByAppendingString:@"/"];
        if (!message.frameInfo.isMainFrame || !frameURL.isFileURL ||
            ![frameURL.URLByResolvingSymlinksInPath.path hasPrefix:trustedPrefix]) {
            replyHandler([self errorResponseWithId:requestId code:@"UNTRUSTED_FRAME"
                                          message:@"WaterlooWorks is available only to the bundled FocusDesk page."], nil);
            return;
        }
        FDWaterlooWorksCompletion complete = ^(NSDictionary *response) {
            NSMutableDictionary *envelope = [response mutableCopy];
            envelope[@"id"] = requestId;
            replyHandler(envelope, nil);
        };
        if ([action isEqualToString:@"waterlooworks.request"]) {
            [self.waterlooWorksClient request:payload completion:complete];
        } else if ([action isEqualToString:@"waterlooworks.config.status"]) {
            if (payload.count != 0) {
                replyHandler([self errorResponseWithId:requestId code:@"INVALID_REQUEST"
                                              message:@"Evaluator status does not accept input."], nil);
                return;
            }
            [self.waterlooWorksClient evaluatorConfigurationStatusWithCompletion:complete];
        } else {
            [self.waterlooWorksClient saveEvaluatorConfiguration:payload completion:complete];
        }
        return;
    }

    NSString *focusDeskOperation = nil;
    if ([action hasPrefix:@"focusdesk.tasks."]) {
        focusDeskOperation = [action substringFromIndex:@"focusdesk.tasks.".length];
    } else if ([action hasPrefix:@"focusdesk.workspace."]) {
        focusDeskOperation = [action substringFromIndex:@"focusdesk.".length];
    }
    if (focusDeskOperation) {
        [self.focusDeskDatabase invokeOperation:focusDeskOperation payload:payload completion:^(NSDictionary *response) {
            if ([response[@"ok"] boolValue]) {
                replyHandler(@{
                    @"id": requestId,
                    @"ok": @YES,
                    @"data": response[@"data"] ?: @{},
                }, nil);
                return;
            }
            replyHandler(@{
                @"id": requestId,
                @"ok": @NO,
                @"error": response[@"error"] ?: @{
                    @"code": @"FOCUSDESK_DATABASE_ERROR",
                    @"message": @"FocusDesk could not access its SQLite database.",
                },
            }, nil);
        }];
        return;
    }

    NSString *taskManagerOperation = nil;
    if ([action isEqualToString:@"taskmanager.health"]) {
        taskManagerOperation = @"system.health";
    } else if ([action hasPrefix:@"tasks."] ||
               [action hasPrefix:@"courses."] ||
               [action isEqualToString:@"data.export"]) {
        taskManagerOperation = action;
    }
    if (taskManagerOperation) {
        [self.taskManagerDatabase invokeOperation:taskManagerOperation payload:payload completion:^(NSDictionary *response) {
            if ([response[@"ok"] boolValue]) {
                replyHandler(@{
                    @"id": requestId,
                    @"ok": @YES,
                    @"data": response,
                }, nil);
                return;
            }

            replyHandler(@{
                @"id": requestId,
                @"ok": @NO,
                @"error": response[@"error"] ?: @{
                    @"code": @"FOCUSDESK_DATABASE_ERROR",
                    @"message": @"FocusDesk could not access its task database.",
                },
            }, nil);
        }];
        return;
    }

    replyHandler([self errorResponseWithId:requestId
                                      code:@"UNKNOWN_ACTION"
                                   message:[NSString stringWithFormat:@"Unknown native action: %@", action]], nil);
}

- (BOOL)openValue:(NSString * _Nullable)value errorMessage:(NSString * _Nullable * _Nullable)errorMessage {
    if (value.length == 0) {
        if (errorMessage) *errorMessage = @"A non-empty URL or absolute path is required.";
        return NO;
    }

    NSURL *url = [NSURL URLWithString:value];
    NSString *scheme = url.scheme.lowercaseString;
    if ([scheme isEqualToString:@"http"] || [scheme isEqualToString:@"https"] || [scheme isEqualToString:@"file"]) {
        return [[NSWorkspace sharedWorkspace] openURL:url];
    }

    NSString *path = [value stringByExpandingTildeInPath];
    if (![path isAbsolutePath]) {
        if (errorMessage) *errorMessage = @"Local links must use an absolute path.";
        return NO;
    }
    return [[NSWorkspace sharedWorkspace] openURL:[NSURL fileURLWithPath:path]];
}

- (NSDictionary *)errorResponseWithId:(NSString *)requestId
                                  code:(NSString *)code
                               message:(NSString *)message {
    return @{
        @"id": requestId,
        @"ok": @NO,
        @"error": @{ @"code": code, @"message": message }
    };
}

@end
