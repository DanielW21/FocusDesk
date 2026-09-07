#import "FDWaterlooWorksClient.h"

#import <Cocoa/Cocoa.h>
#import <Security/Security.h>
#import <fcntl.h>
#import <signal.h>
#import <unistd.h>

static const NSUInteger FDWWMaxBody = 64 * 1024;
static const NSUInteger FDWWMaxResponse = 16 * 1024 * 1024;

static NSDictionary *FDWWError(NSString *code, NSString *message) {
    return @{ @"ok": @NO, @"error": @{ @"code": code, @"message": message } };
}

static NSArray<NSString *> *FDWWEvaluatorFiles(void) {
    static NSArray<NSString *> *files;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        files = @[ @"profile.json", @"candidate-context.md", @"category-guidance.md", @"instructions.md", @"schema.json" ];
    });
    return files;
}

static NSString *FDWWEnvironmentValue(NSString *contents, NSString *name) {
    for (NSString *line in [contents componentsSeparatedByCharactersInSet:NSCharacterSet.newlineCharacterSet]) {
        NSRange equals = [line rangeOfString:@"="];
        if (equals.location == NSNotFound) continue;
        NSString *key = [[line substringToIndex:equals.location] stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceCharacterSet];
        if ([key hasPrefix:@"export "]) key = [[key substringFromIndex:7] stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceCharacterSet];
        if (![key isEqualToString:name]) continue;
        NSString *value = [[line substringFromIndex:equals.location + 1] stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceCharacterSet];
        if (value.length >= 2 && (([value hasPrefix:@"\""] && [value hasSuffix:@"\""]) || ([value hasPrefix:@"'"] && [value hasSuffix:@"'"])))
            value = [value substringWithRange:NSMakeRange(1, value.length - 2)];
        return value;
    }
    return nil;
}

static NSString *FDWWUpdatedEnvironment(NSString *contents, NSDictionary<NSString *, NSString *> *updates) {
    NSMutableArray<NSString *> *lines = [NSMutableArray array];
    for (NSString *line in [contents componentsSeparatedByCharactersInSet:NSCharacterSet.newlineCharacterSet]) {
        NSRange equals = [line rangeOfString:@"="];
        NSString *key = equals.location == NSNotFound ? @"" : [[line substringToIndex:equals.location] stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceCharacterSet];
        if ([key hasPrefix:@"export "]) key = [[key substringFromIndex:7] stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceCharacterSet];
        if (![updates objectForKey:key]) [lines addObject:line];
    }
    while (lines.count > 0 && lines.lastObject.length == 0) [lines removeLastObject];
    for (NSString *key in updates) [lines addObject:[NSString stringWithFormat:@"%@=%@", key, updates[key]]];
    return [[lines componentsJoinedByString:@"\n"] stringByAppendingString:@"\n"];
}

static BOOL FDWWSafeEnvironmentValue(NSString *value, NSUInteger maxLength) {
    return [value isKindOfClass:NSString.class] && value.length > 0 && value.length <= maxLength &&
        [value rangeOfCharacterFromSet:NSCharacterSet.newlineCharacterSet].location == NSNotFound &&
        [value rangeOfCharacterFromSet:NSCharacterSet.controlCharacterSet].location == NSNotFound;
}

// A delegate caps response bytes while they arrive and refuses every redirect,
// including redirects to another loopback port. It never exposes transport errors
// (which can contain the private service URL) to the renderer.
@interface FDWWTransfer : NSObject <NSURLSessionDataDelegate>
@property (strong) NSMutableData *data;
@property (strong) NSURLSession *session;
@property (copy) FDWaterlooWorksCompletion completion;
@property (assign) NSInteger status;
@property (assign) BOOL rejected;
- (void)start:(NSURLRequest *)request completion:(FDWaterlooWorksCompletion)completion;
@end

@implementation FDWWTransfer
- (void)start:(NSURLRequest *)request completion:(FDWaterlooWorksCompletion)completion {
    self.data = [NSMutableData data];
    self.completion = completion;
    NSURLSessionConfiguration *configuration = [NSURLSessionConfiguration ephemeralSessionConfiguration];
    configuration.connectionProxyDictionary = @{};
    configuration.HTTPCookieStorage = nil;
    configuration.URLCache = nil;
    configuration.URLCredentialStorage = nil;
    configuration.timeoutIntervalForRequest = 30;
    configuration.timeoutIntervalForResource = 30;
    self.session = [NSURLSession sessionWithConfiguration:configuration delegate:self delegateQueue:nil];
    [[self.session dataTaskWithRequest:request] resume];
}
- (void)URLSession:(NSURLSession *)session task:(NSURLSessionTask *)task
 willPerformHTTPRedirection:(NSHTTPURLResponse *)response newRequest:(NSURLRequest *)request
 completionHandler:(void (^)(NSURLRequest *))completionHandler {
    self.rejected = YES;
    completionHandler(nil);
}
- (void)URLSession:(NSURLSession *)session dataTask:(NSURLSessionDataTask *)task
 didReceiveResponse:(NSURLResponse *)response completionHandler:(void (^)(NSURLSessionResponseDisposition))completionHandler {
    self.status = [(NSHTTPURLResponse *)response statusCode];
    self.rejected = self.rejected || response.expectedContentLength > (long long)FDWWMaxResponse ||
        ![response.MIMEType.lowercaseString isEqualToString:@"application/json"];
    completionHandler(self.rejected ? NSURLSessionResponseCancel : NSURLSessionResponseAllow);
}
- (void)URLSession:(NSURLSession *)session dataTask:(NSURLSessionDataTask *)task didReceiveData:(NSData *)data {
    if (data.length > FDWWMaxResponse - self.data.length) {
        self.rejected = YES;
        [task cancel];
    } else {
        [self.data appendData:data];
    }
}
- (void)URLSession:(NSURLSession *)session task:(NSURLSessionTask *)task didCompleteWithError:(NSError *)error {
    id json = !error && !self.rejected ? [NSJSONSerialization JSONObjectWithData:self.data options:0 error:nil] : nil;
    NSDictionary *response;
    if (![json isKindOfClass:[NSDictionary class]] && ![json isKindOfClass:[NSArray class]]) {
        response = FDWWError(@"WATERLOOWORKS_SERVICE_ERROR", @"The WaterlooWorks service did not return a valid response. Try again.");
    } else if (self.status < 200 || self.status >= 300) {
        NSDictionary *details = [json isKindOfClass:[NSDictionary class]] ? json[@"error"] : nil;
        if ([details isKindOfClass:[NSDictionary class]] &&
            [details[@"code"] isKindOfClass:[NSString class]] && [details[@"message"] isKindOfClass:[NSString class]]) {
            response = @{ @"ok": @NO, @"error": details };
        } else {
            response = FDWWError(@"WATERLOOWORKS_SERVICE_ERROR", @"The WaterlooWorks request failed.");
        }
    } else {
        response = @{ @"ok": @YES, @"data": json };
    }
    FDWaterlooWorksCompletion completion = self.completion;
    self.completion = nil;
    [session finishTasksAndInvalidate];
    self.session = nil;
    completion(response);
}
@end

@interface FDWaterlooWorksClient ()
@property (strong) dispatch_queue_t queue;
@property (strong) NSTask *child;
@property (strong) NSPipe *output;
@property (strong) NSPipe *errors;
@property (strong) dispatch_source_t outputTimer;
@property (strong) NSMutableData *readyLine;
@property (strong) NSMutableArray *waiting;
@property (strong) NSMutableSet<FDWWTransfer *> *transfers;
@property (copy) NSString *token;
@property (assign) NSInteger port;
@property (assign) BOOL stopped;
@end

@implementation FDWaterlooWorksClient
- (instancetype)init {
    if ((self = [super init])) {
        _queue = dispatch_queue_create("com.danielwu.focusdesk.waterlooworks", DISPATCH_QUEUE_SERIAL);
        _waiting = [NSMutableArray array];
        _transfers = [NSMutableSet set];
        [[NSNotificationCenter defaultCenter] addObserver:self selector:@selector(applicationWillTerminate:)
                                                    name:NSApplicationWillTerminateNotification object:nil];
    }
    return self;
}
- (void)applicationWillTerminate:(NSNotification *)notification { [self shutdown]; }

- (NSURL *)evaluatorConfigurationDirectoryWithError:(NSString **)errorMessage {
    NSFileManager *fm = NSFileManager.defaultManager;
    NSError *error = nil;
    NSURL *support = [fm URLForDirectory:NSApplicationSupportDirectory inDomain:NSUserDomainMask appropriateForURL:nil create:YES error:&error];
    NSURL *directory = [support URLByAppendingPathComponent:@"FocusDesk/waterlooworks/config" isDirectory:YES];
    if (!support || ![fm createDirectoryAtURL:directory withIntermediateDirectories:YES attributes:@{NSFilePosixPermissions: @0700} error:&error] ||
        ![fm setAttributes:@{NSFilePosixPermissions: @0700} ofItemAtPath:directory.path error:&error]) {
        if (errorMessage) *errorMessage = @"FocusDesk could not open its private evaluator storage.";
        return nil;
    }
    return directory;
}

- (void)migrateLegacyEvaluatorConfigurationIntoDirectory:(NSURL *)directory {
    NSURL *legacy = [[NSURL fileURLWithPath:NSHomeDirectory() isDirectory:YES]
        URLByAppendingPathComponent:@"Development/WaterlooWorks/llm-pass/config" isDirectory:YES];
    NSFileManager *fm = NSFileManager.defaultManager;
    NSDictionary *legacyAttributes = [fm attributesOfItemAtPath:legacy.path error:nil];
    if (![legacyAttributes[NSFileType] isEqualToString:NSFileTypeDirectory]) return;

    // The old grader used profile.example.json as its fallback when a private
    // profile.json did not exist. Preserve that behavior while making the
    // packaged FocusDesk service self-contained for this existing installation.
    for (NSString *name in FDWWEvaluatorFiles()) {
        NSURL *destination = [directory URLByAppendingPathComponent:name];
        if ([fm fileExistsAtPath:destination.path]) continue;
        NSString *sourceName = [name isEqualToString:@"profile.json"] ? @"profile.json" : name;
        NSURL *source = [legacy URLByAppendingPathComponent:sourceName];
        if (![fm fileExistsAtPath:source.path] && [name isEqualToString:@"profile.json"])
            source = [legacy URLByAppendingPathComponent:@"profile.example.json"];
        NSDictionary *attributes = [fm attributesOfItemAtPath:source.path error:nil];
        unsigned long long size = [attributes[NSFileSize] unsignedLongLongValue];
        if (!attributes || size == 0 || size > 1024 * 1024) continue;
        NSData *data = [NSData dataWithContentsOfURL:source options:0 error:nil];
        if (data && [data writeToURL:destination options:NSDataWritingAtomic error:nil])
            [fm setAttributes:@{NSFilePosixPermissions: @0600} ofItemAtPath:destination.path error:nil];
    }

    // Migrate only the known evaluator variables from the old ignored env
    // file. Other legacy environment values never enter FocusDesk.
    NSURL *legacyEnvironmentURL = [[legacy URLByDeletingLastPathComponent]
        URLByAppendingPathComponent:@".env.local"];
    NSURL *environmentURL = [directory URLByAppendingPathComponent:@".env.local"];
    NSString *legacyEnvironment = [NSString stringWithContentsOfURL:legacyEnvironmentURL encoding:NSUTF8StringEncoding error:nil] ?: @"";
    NSString *currentEnvironment = [NSString stringWithContentsOfURL:environmentURL encoding:NSUTF8StringEncoding error:nil] ?: @"";
    NSMutableDictionary *updates = [NSMutableDictionary dictionary];
    for (NSString *key in @[ @"DEEPSEEK_API_KEY", @"DEEPSEEK_BASE_URL", @"DEEPSEEK_MODEL" ]) {
        if (FDWWSafeEnvironmentValue(FDWWEnvironmentValue(currentEnvironment, key), 4096)) continue;
        NSString *value = FDWWEnvironmentValue(legacyEnvironment, key);
        NSUInteger maxLength = [key isEqualToString:@"DEEPSEEK_API_KEY"] ? 4096 : ([key isEqualToString:@"DEEPSEEK_BASE_URL"] ? 2048 : 128);
        if (FDWWSafeEnvironmentValue(value, maxLength)) updates[key] = value;
    }
    if (updates.count > 0) {
        NSData *data = [FDWWUpdatedEnvironment(currentEnvironment, updates) dataUsingEncoding:NSUTF8StringEncoding];
        if ([data writeToURL:environmentURL options:NSDataWritingAtomic error:nil])
            [fm setAttributes:@{NSFilePosixPermissions: @0600} ofItemAtPath:environmentURL.path error:nil];
    }
}

- (NSDictionary *)evaluatorConfigurationStatus {
    NSString *directoryError = nil;
    NSURL *directory = [self evaluatorConfigurationDirectoryWithError:&directoryError];
    if (!directory) return FDWWError(@"WATERLOOWORKS_STORAGE_ERROR", directoryError);
    [self migrateLegacyEvaluatorConfigurationIntoDirectory:directory];
    NSString *environment = [NSString stringWithContentsOfURL:[directory URLByAppendingPathComponent:@".env.local"] encoding:NSUTF8StringEncoding error:nil] ?: @"";
    NSMutableDictionary *files = [NSMutableDictionary dictionary];
    BOOL allFilesPresent = YES;
    for (NSString *name in FDWWEvaluatorFiles()) {
        NSDictionary *attributes = [NSFileManager.defaultManager attributesOfItemAtPath:[directory URLByAppendingPathComponent:name].path error:nil];
        unsigned long long fileSize = [attributes[NSFileSize] unsignedLongLongValue];
        BOOL present = fileSize > 0 && fileSize <= 1024 * 1024;
        files[name] = @(present);
        allFilesPresent = allFilesPresent && present;
    }
    BOOL hasKey = FDWWSafeEnvironmentValue(FDWWEnvironmentValue(environment, @"DEEPSEEK_API_KEY"), 4096);
    return @{ @"ok": @YES, @"data": @{ @"apiKeyConfigured": @(hasKey), @"files": files, @"complete": @(hasKey && allFilesPresent) } };
}

- (void)evaluatorConfigurationStatusWithCompletion:(FDWaterlooWorksCompletion)completion {
    dispatch_async(self.queue, ^{
        NSDictionary *response = [self evaluatorConfigurationStatus];
        dispatch_async(dispatch_get_main_queue(), ^{ completion(response); });
    });
}

- (void)saveEvaluatorConfiguration:(NSDictionary *)payload completion:(FDWaterlooWorksCompletion)completion {
    FDWaterlooWorksCompletion reply = ^(NSDictionary *response) {
        dispatch_async(dispatch_get_main_queue(), ^{ completion(response); });
    };
    if (![payload isKindOfClass:NSDictionary.class]) {
        reply(FDWWError(@"INVALID_REQUEST", @"Evaluator setup must be an object."));
        return;
    }
    NSSet *allowed = [NSSet setWithArray:@[ @"apiKey", @"endpoint", @"model", @"files" ]];
    for (id key in payload) if (![key isKindOfClass:NSString.class] || ![allowed containsObject:key]) {
        reply(FDWWError(@"INVALID_REQUEST", @"Unsupported evaluator setup field."));
        return;
    }
    NSString *apiKey = payload[@"apiKey"];
    NSString *endpoint = payload[@"endpoint"];
    NSString *model = payload[@"model"];
    NSDictionary *submittedFiles = payload[@"files"];
    if ((apiKey && !FDWWSafeEnvironmentValue(apiKey, 4096)) ||
        (endpoint && !FDWWSafeEnvironmentValue(endpoint, 2048)) ||
        (model && !FDWWSafeEnvironmentValue(model, 128)) ||
        (submittedFiles && ![submittedFiles isKindOfClass:NSDictionary.class]) ||
        (!apiKey && !endpoint && !model && !submittedFiles)) {
        reply(FDWWError(@"INVALID_REQUEST", @"Evaluator setup contains an invalid value."));
        return;
    }
    if (endpoint) {
        NSURLComponents *components = [NSURLComponents componentsWithString:endpoint];
        if (!components || ![components.scheme.lowercaseString isEqualToString:@"https"] || !components.host.length) {
            reply(FDWWError(@"INVALID_REQUEST", @"The evaluator endpoint must be an HTTPS URL."));
            return;
        }
    }
    NSCharacterSet *validModelCharacters = [NSCharacterSet characterSetWithCharactersInString:@"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._:-"];
    if (model && [model rangeOfCharacterFromSet:validModelCharacters.invertedSet].location != NSNotFound) {
        reply(FDWWError(@"INVALID_REQUEST", @"The evaluator model contains unsupported characters."));
        return;
    }
    for (id name in submittedFiles) {
        NSString *contents = submittedFiles[name];
        if (![name isKindOfClass:NSString.class] || ![FDWWEvaluatorFiles() containsObject:name] ||
            ![contents isKindOfClass:NSString.class] || contents.length == 0 || contents.length > 1024 * 1024) {
            reply(FDWWError(@"INVALID_REQUEST", @"Evaluator files must be one of the five expected non-empty files."));
            return;
        }
    }
    dispatch_async(self.queue, ^{
        NSString *directoryError = nil;
        NSURL *directory = [self evaluatorConfigurationDirectoryWithError:&directoryError];
        if (!directory) { reply(FDWWError(@"WATERLOOWORKS_STORAGE_ERROR", directoryError)); return; }
        [self migrateLegacyEvaluatorConfigurationIntoDirectory:directory];
        NSError *writeError = nil;
        if (apiKey || endpoint || model) {
            NSURL *environmentURL = [directory URLByAppendingPathComponent:@".env.local"];
            NSString *existing = [NSString stringWithContentsOfURL:environmentURL encoding:NSUTF8StringEncoding error:nil] ?: @"";
            NSMutableDictionary *updates = [NSMutableDictionary dictionary];
            if (apiKey) updates[@"DEEPSEEK_API_KEY"] = apiKey;
            if (endpoint) updates[@"DEEPSEEK_BASE_URL"] = endpoint;
            if (model) updates[@"DEEPSEEK_MODEL"] = model;
            NSData *environmentData = [FDWWUpdatedEnvironment(existing, updates) dataUsingEncoding:NSUTF8StringEncoding];
            if (![environmentData writeToURL:environmentURL options:NSDataWritingAtomic error:&writeError] ||
                ![NSFileManager.defaultManager setAttributes:@{NSFilePosixPermissions: @0600} ofItemAtPath:environmentURL.path error:&writeError]) {
                reply(FDWWError(@"WATERLOOWORKS_STORAGE_ERROR", @"FocusDesk could not save evaluator settings."));
                return;
            }
        }
        for (NSString *name in submittedFiles) {
            NSURL *fileURL = [directory URLByAppendingPathComponent:name];
            NSData *data = [submittedFiles[name] dataUsingEncoding:NSUTF8StringEncoding];
            if (!data || ![data writeToURL:fileURL options:NSDataWritingAtomic error:&writeError] ||
                ![NSFileManager.defaultManager setAttributes:@{NSFilePosixPermissions: @0600} ofItemAtPath:fileURL.path error:&writeError]) {
                reply(FDWWError(@"WATERLOOWORKS_STORAGE_ERROR", @"FocusDesk could not save evaluator configuration files."));
                return;
            }
        }
        reply([self evaluatorConfigurationStatus]);
    });
}

// Decode only for matching; send the original, validated relative path. This
// rejects URL authorities, fragments, dot segments, escaped separators and
// double-encoding before Foundation has a chance to normalize them.
- (BOOL)allowsMethod:(NSString *)method path:(NSString *)path {
    if (![@[@"GET", @"POST", @"PUT"] containsObject:method] || path.length > 8192 ||
        ![path hasPrefix:@"/api/v1/"] || [path containsString:@"#"] || [path containsString:@"\\"] ||
        [path rangeOfCharacterFromSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]].location != NSNotFound) return NO;
    NSArray *parts = [path componentsSeparatedByString:@"?"];
    if (parts.count > 2) return NO;
    NSString *route = [parts[0] stringByRemovingPercentEncoding];
    if (!route || [route containsString:@"%"] || [route containsString:@"."]) return NO;
    // Only a job identifier may be escaped, and it cannot contain a separator.
    NSArray *rawSegments = [parts[0] componentsSeparatedByString:@"/"];
    for (NSString *segment in rawSegments) {
        NSString *decoded = segment.stringByRemovingPercentEncoding;
        if (!decoded || [decoded containsString:@"/"] || [decoded containsString:@"\\"]) return NO;
    }
    NSDictionary *routes = @{
        @"GET": @[@"/api/v1/health", @"/api/v1/capabilities", @"/api/v1/jobs", @"/api/v1/ratings", @"/api/v1/runs", @"/api/v1/summary"],
        @"POST": @[@"/api/v1/scrapes", @"/api/v1/grades"],
        @"PUT": @[],
    };
    BOOL allowed = [routes[method] containsObject:route];
    NSString *pattern = [method isEqualToString:@"GET"] ? @"^/api/v1/(jobs|runs)/[A-Za-z0-9_ :\\-]+$" :
        ([method isEqualToString:@"PUT"] ? @"^/api/v1/jobs/[A-Za-z0-9_ :\\-]+/rating$" : @"^/api/v1/runs/[A-Za-z0-9_-]+/cancel$");
    allowed = allowed || [route rangeOfString:pattern options:NSRegularExpressionSearch].location != NSNotFound;
    if (!allowed) return NO;
    if (parts.count == 2) {
        NSDictionary *queries = @{
            @"/api/v1/jobs": @[@"q", @"board", @"minimumScore", @"rating", @"limit", @"cursor"],
            @"/api/v1/runs": @[@"limit", @"board"],
            @"/api/v1/ratings": @[@"board"],
            @"/api/v1/summary": @[@"board"],
        };
        if (![method isEqualToString:@"GET"] || !queries[route]) return NO;
        NSURLComponents *components = [NSURLComponents componentsWithString:path];
        if (!components || components.scheme || components.host || components.fragment) return NO;
        NSMutableSet *seen = [NSMutableSet set];
        for (NSURLQueryItem *item in components.queryItems) {
            if (![queries[route] containsObject:item.name] ||
                !item.value || [seen containsObject:item.name]) return NO;
            [seen addObject:item.name];
        }
    }
    return YES;
}
- (void)request:(NSDictionary *)payload completion:(FDWaterlooWorksCompletion)completion {
    FDWaterlooWorksCompletion reply = ^(NSDictionary *response) {
        dispatch_async(dispatch_get_main_queue(), ^{ completion(response); });
    };
    NSString *method = [payload[@"method"] isKindOfClass:[NSString class]] ? payload[@"method"] : nil;
    NSString *path = [payload[@"path"] isKindOfClass:[NSString class]] ? payload[@"path"] : nil;
    for (NSString *key in payload) {
        if (![@[@"method", @"path", @"body"] containsObject:key]) {
            reply(FDWWError(@"INVALID_REQUEST", @"Unsupported WaterlooWorks request field."));
            return;
        }
    }
    if (!method || !path || ![self allowsMethod:method path:path]) {
        reply(FDWWError(@"INVALID_REQUEST", @"This WaterlooWorks route and method are not permitted."));
        return;
    }
    NSData *body = nil;
    if (payload[@"body"]) {
        if ([method isEqualToString:@"GET"] || ![payload[@"body"] isKindOfClass:[NSDictionary class]] ||
            ![NSJSONSerialization isValidJSONObject:payload[@"body"]]) {
            reply(FDWWError(@"INVALID_REQUEST", @"A JSON object body is permitted only for POST or PUT."));
            return;
        }
        body = [NSJSONSerialization dataWithJSONObject:payload[@"body"] options:0 error:nil];
        if (!body || body.length > FDWWMaxBody) {
            reply(FDWWError(@"INVALID_REQUEST", @"The WaterlooWorks request body exceeds 64 KiB."));
            return;
        }
        NSArray *keys = [path isEqualToString:@"/api/v1/scrapes"] ? @[@"board"] :
            ([path isEqualToString:@"/api/v1/grades"] ? @[@"board", @"all", @"jobKey"] :
            ([method isEqualToString:@"PUT"] ? @[@"rating", @"note"] : @[]));
        for (NSString *key in payload[@"body"]) {
            if (![keys containsObject:key]) {
                reply(FDWWError(@"INVALID_REQUEST", @"Unsupported WaterlooWorks request body field."));
                return;
            }
        }
    }
    dispatch_async(self.queue, ^{
        if (self.stopped || self.waiting.count + self.transfers.count >= 32) {
            reply(FDWWError(@"WATERLOOWORKS_UNAVAILABLE", @"The WaterlooWorks service is stopped or busy."));
            return;
        }
        if (self.child && !self.child.running) [self stopChild];
        void (^send)(NSDictionary *) = ^(NSDictionary *failure) {
            if (failure) { reply(failure); return; }
            NSURL *url = [NSURL URLWithString:[NSString stringWithFormat:@"http://127.0.0.1:%ld%@", (long)self.port, path]];
            NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:url];
            request.HTTPMethod = method;
            request.HTTPBody = body;
            [request setValue:[@"Bearer " stringByAppendingString:self.token] forHTTPHeaderField:@"Authorization"];
            [request setValue:@"application/json" forHTTPHeaderField:@"Accept"];
            if (![method isEqualToString:@"GET"]) {
                [request setValue:@"application/json" forHTTPHeaderField:@"Content-Type"];
                if (!body) request.HTTPBody = [@"{}" dataUsingEncoding:NSUTF8StringEncoding];
            }
            FDWWTransfer *transfer = [FDWWTransfer new];
            [self.transfers addObject:transfer];
            [transfer start:request completion:^(NSDictionary *response) {
                dispatch_async(self.queue, ^{ [self.transfers removeObject:transfer]; reply(response); });
            }];
        };
        if (self.port) { send(nil); return; }
        [self.waiting addObject:[send copy]];
        if (!self.child) [self startChild];
    });
}
- (void)finishWaiting:(NSDictionary *)failure {
    NSArray *waiting = [self.waiting copy];
    [self.waiting removeAllObjects];
    for (void (^send)(NSDictionary *) in waiting) send(failure);
}
- (void)startChild {
    NSURL *resources = [NSBundle mainBundle].resourceURL;
    NSURL *runtime = [resources URLByAppendingPathComponent:@"waterlooworks" isDirectory:YES];
    NSURL *node = [runtime URLByAppendingPathComponent:@"bin/node"];
    NSURL *server = [runtime URLByAppendingPathComponent:@"src/server.js"];
    NSFileManager *fm = [NSFileManager defaultManager];
    if (![fm isExecutableFileAtPath:node.path] || ![fm fileExistsAtPath:server.path]) {
        [self finishWaiting:FDWWError(@"WATERLOOWORKS_RUNTIME_MISSING", @"The bundled WaterlooWorks runtime is missing. Rebuild or reinstall FocusDesk.")];
        return;
    }
    NSURL *support = [fm URLForDirectory:NSApplicationSupportDirectory inDomain:NSUserDomainMask appropriateForURL:nil create:YES error:nil];
    NSURL *central = [support URLByAppendingPathComponent:@"FocusDesk" isDirectory:YES];
    NSURL *privateDirectory = [central URLByAppendingPathComponent:@"waterlooworks" isDirectory:YES];
    if (!support || ![fm createDirectoryAtURL:privateDirectory withIntermediateDirectories:YES attributes:@{NSFilePosixPermissions: @0700} error:nil] ||
        ![fm setAttributes:@{NSFilePosixPermissions: @0700} ofItemAtPath:privateDirectory.path error:nil]) {
        [self finishWaiting:FDWWError(@"WATERLOOWORKS_STORAGE_ERROR", @"The WaterlooWorks private data directory could not be opened.")];
        return;
    }
    unsigned char randomBytes[32];
    if (SecRandomCopyBytes(kSecRandomDefault, sizeof(randomBytes), randomBytes) != errSecSuccess) {
        [self finishWaiting:FDWWError(@"WATERLOOWORKS_START_FAILED", @"A service authentication token could not be created.")];
        return;
    }
    self.token = [[NSData dataWithBytes:randomBytes length:sizeof(randomBytes)] base64EncodedStringWithOptions:0];
    NSTask *child = [NSTask new];
    self.child = child;
    child.executableURL = node;
    child.currentDirectoryURL = privateDirectory;
    child.arguments = @[@"--experimental-sqlite", server.path, @"--port=0",
        [@"--database=" stringByAppendingString:[central URLByAppendingPathComponent:@"focusdesk.sqlite3"].path],
        [@"--data-dir=" stringByAppendingString:central.path],
        [@"--config-dir=" stringByAppendingString:[privateDirectory URLByAppendingPathComponent:@"config"].path]];
    // Deliberately omit NODE_OPTIONS, NODE_PATH, proxy and dynamic-loader env.
    child.environment = @{@"HOME": NSHomeDirectory(), @"TMPDIR": NSTemporaryDirectory(),
        @"PATH": [NSString stringWithFormat:@"%@:/usr/bin:/bin", node.URLByDeletingLastPathComponent.path],
        @"LANG": @"en_US.UTF-8", @"WW_SERVICE_TOKEN": self.token};
    self.output = [NSPipe pipe];
    self.errors = [NSPipe pipe];
    child.standardOutput = self.output;
    child.standardError = self.errors;
    child.standardInput = [NSFileHandle fileHandleWithNullDevice];
    self.readyLine = [NSMutableData data];
    __weak typeof(self) weakSelf = self;
    child.terminationHandler = ^(NSTask *terminated) {
        typeof(self) owner = weakSelf;
        if (!owner) return;
        dispatch_async(owner.queue, ^{
            if (owner.child != terminated) return;
            [owner stopChild];
            [owner finishWaiting:FDWWError(@"WATERLOOWORKS_EXITED", @"The WaterlooWorks service exited. Try again to restart it.")];
        });
    };
    if (![child launchAndReturnError:nil]) {
        [self stopChild];
        [self finishWaiting:FDWWError(@"WATERLOOWORKS_START_FAILED", @"The bundled WaterlooWorks service could not be launched.")];
        return;
    }
    for (NSPipe *pipe in @[self.output, self.errors]) {
        int fd = pipe.fileHandleForReading.fileDescriptor;
        fcntl(fd, F_SETFL, fcntl(fd, F_GETFL) | O_NONBLOCK);
    }
    self.outputTimer = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, self.queue);
    dispatch_source_set_timer(self.outputTimer, DISPATCH_TIME_NOW, 50 * NSEC_PER_MSEC, 10 * NSEC_PER_MSEC);
    dispatch_source_set_event_handler(self.outputTimer, ^{ [weakSelf drainOutput]; });
    dispatch_resume(self.outputTimer);
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 15 * NSEC_PER_SEC), self.queue, ^{
        typeof(self) owner = weakSelf;
        if (owner.child == child && !owner.port) {
            [owner stopChild];
            [owner finishWaiting:FDWWError(@"WATERLOOWORKS_START_TIMEOUT", @"The WaterlooWorks service was not ready within 15 seconds.")];
        }
    });
}
- (void)drainOutput {
    // Bound work and retained bytes even if a malfunctioning child floods logs.
    // stderr and all stdout after readiness are drained without retaining them.
    for (NSPipe *pipe in @[self.errors, self.output]) {
        for (NSUInteger count = 0; count < 16; count++) {
            unsigned char bytes[4096];
            ssize_t length = read(pipe.fileHandleForReading.fileDescriptor, bytes, sizeof(bytes));
            if (length <= 0) break;
            if (pipe != self.output || self.port) continue;
            for (ssize_t i = 0; i < length; i++) {
                if (bytes[i] == '\n') {
                    id record = [NSJSONSerialization JSONObjectWithData:self.readyLine options:0 error:nil];
                    [self.readyLine setLength:0];
                    if (![record isKindOfClass:[NSDictionary class]]) continue;
                    NSNumber *port = record[@"port"];
                    if ([record[@"ready"] isEqual:@YES] && [record[@"service"] isEqual:@"waterlooworks"] &&
                        [record[@"apiVersion"] isEqual:@"v1"] && [record[@"host"] isEqual:@"127.0.0.1"] &&
                        [port isKindOfClass:[NSNumber class]] && port.doubleValue == port.integerValue &&
                        port.integerValue > 0 && port.integerValue <= 65535) {
                        self.port = port.integerValue;
                        [self finishWaiting:nil];
                        break;
                    }
                } else {
                    if (self.readyLine.length >= FDWWMaxBody) {
                        [self stopChild];
                        [self finishWaiting:FDWWError(@"WATERLOOWORKS_START_FAILED", @"The WaterlooWorks readiness record exceeded its size limit.")];
                        return;
                    }
                    [self.readyLine appendBytes:bytes + i length:1];
                }
            }
        }
    }
}
- (void)stopChild {
    if (self.outputTimer) { dispatch_source_cancel(self.outputTimer); self.outputTimer = nil; }
    NSTask *child = self.child;
    child.terminationHandler = nil;
    if (child.running) {
        [child terminate];
        // Bounded grace period also runs synchronously during the quit notification.
        for (NSUInteger i = 0; i < 100 && child.running; i++) usleep(10000);
        if (child.running) kill(child.processIdentifier, SIGKILL);
    }
    [self.output.fileHandleForReading closeFile];
    [self.errors.fileHandleForReading closeFile];
    self.output = nil;
    self.errors = nil;
    self.child = nil;
    self.readyLine = nil;
    self.token = nil;
    self.port = 0;
    for (FDWWTransfer *transfer in self.transfers) [transfer.session invalidateAndCancel];
}
- (void)shutdown {
    dispatch_sync(self.queue, ^{
        self.stopped = YES;
        [self stopChild];
        [self finishWaiting:FDWWError(@"WATERLOOWORKS_STOPPED", @"FocusDesk is shutting down.")];
    });
}
- (void)dealloc {
    [[NSNotificationCenter defaultCenter] removeObserver:self];
    if (_outputTimer) dispatch_source_cancel(_outputTimer);
    _child.terminationHandler = nil;
    if (_child.running) { [_child terminate]; if (_child.running) kill(_child.processIdentifier, SIGKILL); }
    [_output.fileHandleForReading closeFile];
    [_errors.fileHandleForReading closeFile];
}
@end
