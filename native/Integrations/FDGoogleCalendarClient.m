#import "FDGoogleCalendarClient.h"

#import <Cocoa/Cocoa.h>
#import <CommonCrypto/CommonDigest.h>
#import <Security/Security.h>
#import <arpa/inet.h>
#import <netinet/in.h>
#import <sys/socket.h>
#import <unistd.h>

static NSString *const FDGoogleRefreshTokenService = @"com.danielwu.focusdesk.google-calendar";
static NSString *const FDGoogleRefreshTokenAccount = @"refresh-token";
static NSString *const FDGoogleClientIDDefaultsKey = @"googleCalendar.clientId";
static NSString *const FDGoogleScopesDefaultsKey = @"googleCalendar.scopes";
static NSString *const FDGoogleCalendarIDDefaultsKey = @"googleCalendar.calendarId";
static NSString *const FDGoogleLastSyncDefaultsKey = @"googleCalendar.lastSyncAt";
static NSString *const FDGoogleClientSecretInfoKey = @"FDGoogleClientSecret";

typedef void (^FDGoogleJSONCompletion)(NSDictionary *_Nullable json,
                                       NSInteger statusCode,
                                       NSString *_Nullable errorMessage);
typedef void (^FDGoogleTokenCompletion)(NSString *_Nullable token,
                                        NSString *_Nullable errorMessage);

@interface FDGoogleCalendarClient ()
@property (strong) NSURLSession *session;
@property (copy) NSString *accessToken;
@property (strong) NSDate *accessTokenExpiry;
@property (copy) NSString *clientId;
@property (copy) NSString *clientSecret;
@property (copy) NSArray<NSString *> *scopes;
@property (copy) NSString *calendarId;
@property (copy) NSArray<NSString *> *calendarIds;
@property BOOL fullSync;
@property (strong) NSUserDefaults *defaults;
@end

@implementation FDGoogleCalendarClient

- (instancetype)init {
    self = [super init];
    if (self) {
        NSURLSessionConfiguration *configuration = [NSURLSessionConfiguration ephemeralSessionConfiguration];
        configuration.requestCachePolicy = NSURLRequestReloadIgnoringLocalCacheData;
        _session = [NSURLSession sessionWithConfiguration:configuration];
        _defaults = [NSUserDefaults standardUserDefaults];
        _clientId = [_defaults stringForKey:FDGoogleClientIDDefaultsKey] ?: @"";
        _clientSecret = [[NSBundle mainBundle] objectForInfoDictionaryKey:FDGoogleClientSecretInfoKey] ?: @"";
        _scopes = [_defaults arrayForKey:FDGoogleScopesDefaultsKey] ?: @[];
        _calendarId = [_defaults stringForKey:FDGoogleCalendarIDDefaultsKey] ?: @"primary";
        _calendarIds = @[];
        _fullSync = NO;
    }
    return self;
}

- (void)invokeOperation:(NSString *)operation
                payload:(NSDictionary *)payload
             completion:(FDGoogleCalendarCompletion)completion {
    [self configureFromPayload:payload];
    if ([operation isEqualToString:@"status"]) {
        completion(@{ @"ok": @YES, @"data": [self statusData] });
        return;
    }
    if ([operation isEqualToString:@"authorize"]) {
        [self authorizeWithCompletion:completion];
        return;
    }
    if ([operation isEqualToString:@"calendars"]) {
        [self calendarListWithCompletion:completion];
        return;
    }
    if ([operation isEqualToString:@"sync"]) {
        [self syncWithCompletion:completion];
        return;
    }
    if ([operation isEqualToString:@"create"] ||
        [operation isEqualToString:@"update"] ||
        [operation isEqualToString:@"delete"]) {
        [self invokeEventOperation:operation payload:payload completion:completion];
        return;
    }
    if ([operation isEqualToString:@"disconnect"]) {
        [self disconnectWithCompletion:completion];
        return;
    }
    completion([self errorWithCode:@"UNKNOWN_GOOGLE_CALENDAR_OPERATION"
                             message:[NSString stringWithFormat:@"Unknown Google Calendar operation: %@", operation]]);
}

- (void)configureFromPayload:(NSDictionary *)payload {
    NSString *clientId = [payload[@"clientId"] isKindOfClass:[NSString class]] ? payload[@"clientId"] : nil;
    if (clientId.length > 0) {
        self.clientId = clientId;
        [self.defaults setObject:clientId forKey:FDGoogleClientIDDefaultsKey];
    }

    NSArray *scopes = [payload[@"scopes"] isKindOfClass:[NSArray class]] ? payload[@"scopes"] : nil;
    if (scopes.count > 0) {
        NSMutableArray *validScopes = [NSMutableArray array];
        for (id scope in scopes) {
            if ([scope isKindOfClass:[NSString class]] && [scope length] > 0) {
                [validScopes addObject:scope];
            }
        }
        if (validScopes.count > 0) {
            self.scopes = validScopes;
            [self.defaults setObject:validScopes forKey:FDGoogleScopesDefaultsKey];
        }
    }

    NSString *calendarId = [payload[@"calendarId"] isKindOfClass:[NSString class]] ? payload[@"calendarId"] : nil;
    if (calendarId.length > 0) {
        self.calendarId = calendarId;
        [self.defaults setObject:calendarId forKey:FDGoogleCalendarIDDefaultsKey];
    }

    NSArray *calendarIds = [payload[@"calendarIds"] isKindOfClass:[NSArray class]] ? payload[@"calendarIds"] : nil;
    if (calendarIds) {
        NSMutableArray *validCalendarIds = [NSMutableArray array];
        for (id value in calendarIds) {
            if ([value isKindOfClass:[NSString class]] && [value length] > 0 && ![validCalendarIds containsObject:value]) {
                [validCalendarIds addObject:value];
            }
        }
        self.calendarIds = validCalendarIds;
    }
    self.fullSync = [payload[@"fullSync"] boolValue];
}

- (NSDictionary *)statusData {
    NSMutableDictionary *data = [@{
        @"connected": @([self refreshToken].length > 0),
        @"calendarId": self.calendarId ?: @"primary",
    } mutableCopy];
    NSString *lastSyncAt = [self.defaults stringForKey:FDGoogleLastSyncDefaultsKey];
    if (lastSyncAt.length > 0) data[@"lastSyncAt"] = lastSyncAt;
    return data;
}

- (NSDictionary *)successWithData:(NSDictionary *)data {
    return @{ @"ok": @YES, @"data": data ?: @{} };
}

- (NSDictionary *)errorWithCode:(NSString *)code message:(NSString *)message {
    return @{ @"ok": @NO, @"error": @{ @"code": code, @"message": message } };
}

- (NSString *)refreshToken {
    NSDictionary *query = @{
        (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
        (__bridge id)kSecAttrService: FDGoogleRefreshTokenService,
        (__bridge id)kSecAttrAccount: FDGoogleRefreshTokenAccount,
        (__bridge id)kSecReturnData: @YES,
        (__bridge id)kSecMatchLimit: (__bridge id)kSecMatchLimitOne,
    };
    CFTypeRef result = NULL;
    OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)query, &result);
    if (status != errSecSuccess || !result) return nil;
    NSData *data = CFBridgingRelease(result);
    return [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
}

- (BOOL)saveRefreshToken:(NSString *)token errorMessage:(NSString **)errorMessage {
    NSDictionary *query = @{
        (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
        (__bridge id)kSecAttrService: FDGoogleRefreshTokenService,
        (__bridge id)kSecAttrAccount: FDGoogleRefreshTokenAccount,
    };
    SecItemDelete((__bridge CFDictionaryRef)query);
    NSMutableDictionary *addQuery = [query mutableCopy];
    addQuery[(__bridge id)kSecValueData] = [token dataUsingEncoding:NSUTF8StringEncoding];
    addQuery[(__bridge id)kSecAttrAccessible] = (__bridge id)kSecAttrAccessibleWhenUnlockedThisDeviceOnly;
    OSStatus status = SecItemAdd((__bridge CFDictionaryRef)addQuery, NULL);
    if (status == errSecSuccess) return YES;
    if (errorMessage) *errorMessage = [NSString stringWithFormat:@"Keychain error (%d).", (int)status];
    return NO;
}

- (void)deleteRefreshToken {
    NSDictionary *query = @{
        (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
        (__bridge id)kSecAttrService: FDGoogleRefreshTokenService,
        (__bridge id)kSecAttrAccount: FDGoogleRefreshTokenAccount,
    };
    SecItemDelete((__bridge CFDictionaryRef)query);
    self.accessToken = nil;
    self.accessTokenExpiry = nil;
}

- (NSString *)base64URLString:(NSData *)data {
    NSString *value = [data base64EncodedStringWithOptions:0];
    value = [value stringByReplacingOccurrencesOfString:@"+" withString:@"-"];
    value = [value stringByReplacingOccurrencesOfString:@"/" withString:@"_"];
    return [value stringByReplacingOccurrencesOfString:@"=" withString:@""];
}

- (NSString *)randomURLStringWithLength:(NSUInteger)length {
    NSMutableData *data = [NSMutableData dataWithLength:length];
    if (SecRandomCopyBytes(kSecRandomDefault, length, data.mutableBytes) != errSecSuccess) {
        return [[NSUUID UUID] UUIDString];
    }
    return [self base64URLString:data];
}

- (NSString *)pkceChallengeForVerifier:(NSString *)verifier {
    NSData *data = [verifier dataUsingEncoding:NSUTF8StringEncoding];
    unsigned char digest[CC_SHA256_DIGEST_LENGTH];
    CC_SHA256(data.bytes, (CC_LONG)data.length, digest);
    return [self base64URLString:[NSData dataWithBytes:digest length:sizeof(digest)]];
}

- (NSString *)formEncodedBody:(NSDictionary<NSString *, NSString *> *)values {
    NSMutableArray *items = [NSMutableArray array];
    for (NSString *key in values) {
        NSURLQueryItem *item = [NSURLQueryItem queryItemWithName:key value:values[key]];
        [items addObject:item];
    }
    NSURLComponents *components = [NSURLComponents new];
    components.queryItems = items;
    return components.percentEncodedQuery ?: @"";
}

- (void)authorizeWithCompletion:(FDGoogleCalendarCompletion)completion {
    if (self.clientId.length == 0) {
        completion([self errorWithCode:@"GOOGLE_CLIENT_ID_MISSING"
                                 message:@"A Google Desktop OAuth client ID is required."]);
        return;
    }
    NSArray *scopes = self.scopes.count > 0
        ? self.scopes
        : @[ @"https://www.googleapis.com/auth/calendar.events" ];
    NSString *state = [self randomURLStringWithLength:24];
    NSString *verifier = [self randomURLStringWithLength:48];
    NSString *challenge = [self pkceChallengeForVerifier:verifier];

    int serverSocket = socket(AF_INET, SOCK_STREAM, 0);
    if (serverSocket < 0) {
        completion([self errorWithCode:@"GOOGLE_OAUTH_SERVER_FAILED"
                                 message:@"FocusDesk could not start the local OAuth callback."]);
        return;
    }
    int reuse = 1;
    setsockopt(serverSocket, SOL_SOCKET, SO_REUSEADDR, &reuse, sizeof(reuse));
    struct sockaddr_in address;
    memset(&address, 0, sizeof(address));
    address.sin_family = AF_INET;
    address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    address.sin_port = 0;
    if (bind(serverSocket, (struct sockaddr *)&address, sizeof(address)) != 0 || listen(serverSocket, 1) != 0) {
        close(serverSocket);
        completion([self errorWithCode:@"GOOGLE_OAUTH_SERVER_FAILED"
                                 message:@"FocusDesk could not bind the local OAuth callback."]);
        return;
    }
    socklen_t addressLength = sizeof(address);
    getsockname(serverSocket, (struct sockaddr *)&address, &addressLength);
    NSUInteger port = ntohs(address.sin_port);
    NSString *redirectURI = [NSString stringWithFormat:@"http://127.0.0.1:%lu/oauth2callback", (unsigned long)port];

    NSURLComponents *authorizationComponents = [NSURLComponents componentsWithString:@"https://accounts.google.com/o/oauth2/v2/auth"];
    authorizationComponents.queryItems = @[
        [NSURLQueryItem queryItemWithName:@"client_id" value:self.clientId],
        [NSURLQueryItem queryItemWithName:@"redirect_uri" value:redirectURI],
        [NSURLQueryItem queryItemWithName:@"response_type" value:@"code"],
        [NSURLQueryItem queryItemWithName:@"scope" value:[scopes componentsJoinedByString:@" "]],
        [NSURLQueryItem queryItemWithName:@"access_type" value:@"offline"],
        [NSURLQueryItem queryItemWithName:@"prompt" value:@"consent"],
        [NSURLQueryItem queryItemWithName:@"state" value:state],
        [NSURLQueryItem queryItemWithName:@"code_challenge" value:challenge],
        [NSURLQueryItem queryItemWithName:@"code_challenge_method" value:@"S256"],
    ];
    NSURL *authorizationURL = authorizationComponents.URL;
    if (!authorizationURL) {
        close(serverSocket);
        completion([self errorWithCode:@"GOOGLE_OAUTH_URL_FAILED"
                                 message:@"FocusDesk could not create the Google authorization URL."]);
        return;
    }

    dispatch_async(dispatch_get_main_queue(), ^{
        [[NSWorkspace sharedWorkspace] openURL:authorizationURL];
    });

    __weak FDGoogleCalendarClient *weakSelf = self;
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
        FDGoogleCalendarClient *strongSelf = weakSelf;
        if (!strongSelf) return;
        struct timeval timeout = { 300, 0 };
        fd_set readSet;
        FD_ZERO(&readSet);
        FD_SET(serverSocket, &readSet);
        int ready = select(serverSocket + 1, &readSet, NULL, NULL, &timeout);
        if (ready <= 0) {
            close(serverSocket);
            dispatch_async(dispatch_get_main_queue(), ^{
                completion([strongSelf errorWithCode:@"GOOGLE_OAUTH_TIMEOUT"
                                               message:@"Google authorization timed out."]);
            });
            return;
        }
        int clientSocket = accept(serverSocket, NULL, NULL);
        close(serverSocket);
        if (clientSocket < 0) {
            dispatch_async(dispatch_get_main_queue(), ^{
                completion([strongSelf errorWithCode:@"GOOGLE_OAUTH_CALLBACK_FAILED"
                                               message:@"FocusDesk could not receive the Google authorization response."]);
            });
            return;
        }
        char buffer[8192];
        ssize_t count = read(clientSocket, buffer, sizeof(buffer) - 1);
        if (count > 0) buffer[count] = '\0';
        NSString *request = count > 0 ? [[NSString alloc] initWithUTF8String:buffer] : @"";
        NSString *responseHTML = @"<html><body>You can close this window and return to FocusDesk.</body></html>";
        NSString *httpResponse = [NSString stringWithFormat:@"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: %lu\r\nConnection: close\r\n\r\n%@", (unsigned long)[responseHTML lengthOfBytesUsingEncoding:NSUTF8StringEncoding], responseHTML];
        NSData *httpData = [httpResponse dataUsingEncoding:NSUTF8StringEncoding];
        write(clientSocket, httpData.bytes, httpData.length);
        close(clientSocket);

        NSArray<NSString *> *lines = [request componentsSeparatedByString:@"\r\n"];
        NSArray<NSString *> *requestParts = lines.count > 0 ? [lines[0] componentsSeparatedByString:@" "] : @[];
        NSString *target = requestParts.count > 1 ? requestParts[1] : nil;
        NSURLComponents *callbackComponents = target.length > 0
            ? [NSURLComponents componentsWithString:[NSString stringWithFormat:@"http://localhost%@", target]]
            : nil;
        NSString *code = nil;
        NSString *returnedState = nil;
        NSString *oauthError = nil;
        for (NSURLQueryItem *item in callbackComponents.queryItems) {
            if ([item.name isEqualToString:@"code"]) code = item.value;
            if ([item.name isEqualToString:@"state"]) returnedState = item.value;
            if ([item.name isEqualToString:@"error"]) oauthError = item.value;
        }
        if (oauthError.length > 0) {
            dispatch_async(dispatch_get_main_queue(), ^{
                completion([strongSelf errorWithCode:@"GOOGLE_OAUTH_DENIED"
                                               message:[NSString stringWithFormat:@"Google authorization failed: %@", oauthError]]);
            });
            return;
        }
        if (code.length == 0 || ![returnedState isEqualToString:state]) {
            dispatch_async(dispatch_get_main_queue(), ^{
                completion([strongSelf errorWithCode:@"GOOGLE_OAUTH_INVALID_CALLBACK"
                                               message:@"The Google authorization response could not be validated."]);
            });
            return;
        }
        [strongSelf exchangeAuthorizationCode:code
                                    verifier:verifier
                                  redirectURI:redirectURI
                                   completion:completion];
    });
}

- (void)exchangeAuthorizationCode:(NSString *)code
                          verifier:(NSString *)verifier
                        redirectURI:(NSString *)redirectURI
                         completion:(FDGoogleCalendarCompletion)completion {
    NSURL *url = [NSURL URLWithString:@"https://oauth2.googleapis.com/token"];
    NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:url];
    request.HTTPMethod = @"POST";
    [request setValue:@"application/x-www-form-urlencoded" forHTTPHeaderField:@"Content-Type"];
    NSMutableDictionary *parameters = [@{
        @"client_id": self.clientId,
        @"code": code,
        @"code_verifier": verifier,
        @"grant_type": @"authorization_code",
        @"redirect_uri": redirectURI,
    } mutableCopy];
    if (self.clientSecret.length > 0) parameters[@"client_secret"] = self.clientSecret;
    request.HTTPBody = [[self formEncodedBody:parameters] dataUsingEncoding:NSUTF8StringEncoding];
    [[self.session dataTaskWithRequest:request completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
        if (error) {
            completion([self errorWithCode:@"GOOGLE_TOKEN_EXCHANGE_FAILED" message:error.localizedDescription]);
            return;
        }
        NSDictionary *json = [self jsonDictionary:data errorMessage:nil];
        if (![response isKindOfClass:[NSHTTPURLResponse class]] || ((NSHTTPURLResponse *)response).statusCode < 200 || ((NSHTTPURLResponse *)response).statusCode >= 300) {
            NSString *message = [json[@"error_description"] isKindOfClass:[NSString class]] ? json[@"error_description"] : @"Google did not accept the authorization code.";
            completion([self errorWithCode:@"GOOGLE_TOKEN_EXCHANGE_FAILED" message:message]);
            return;
        }
        NSString *accessToken = [json[@"access_token"] isKindOfClass:[NSString class]] ? json[@"access_token"] : nil;
        NSString *refreshToken = [json[@"refresh_token"] isKindOfClass:[NSString class]] ? json[@"refresh_token"] : [self refreshToken];
        NSNumber *expiresIn = [json[@"expires_in"] isKindOfClass:[NSNumber class]] ? json[@"expires_in"] : @3600;
        if (accessToken.length == 0 || refreshToken.length == 0) {
            completion([self errorWithCode:@"GOOGLE_TOKEN_EXCHANGE_FAILED" message:@"Google did not return the required tokens."]);
            return;
        }
        NSString *keychainError = nil;
        if (![self saveRefreshToken:refreshToken errorMessage:&keychainError]) {
            completion([self errorWithCode:@"GOOGLE_KEYCHAIN_WRITE_FAILED" message:keychainError ?: @"FocusDesk could not save the Google refresh token."]);
            return;
        }
        self.accessToken = accessToken;
        self.accessTokenExpiry = [NSDate dateWithTimeIntervalSinceNow:expiresIn.doubleValue];
        dispatch_async(dispatch_get_main_queue(), ^{
            completion([self successWithData:@{
                @"connected": @YES,
                @"calendarId": self.calendarId ?: @"primary",
            }]);
        });
    }] resume];
}

- (void)accessTokenWithCompletion:(FDGoogleTokenCompletion)completion {
    if (self.accessToken.length > 0 && [self.accessTokenExpiry timeIntervalSinceNow] > 60) {
        completion(self.accessToken, nil);
        return;
    }
    NSString *refreshToken = [self refreshToken];
    if (refreshToken.length == 0) {
        completion(nil, @"Google Calendar is not connected.");
        return;
    }
    if (self.clientId.length == 0) {
        completion(nil, @"The Google OAuth client ID is missing.");
        return;
    }
    NSURL *url = [NSURL URLWithString:@"https://oauth2.googleapis.com/token"];
    NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:url];
    request.HTTPMethod = @"POST";
    [request setValue:@"application/x-www-form-urlencoded" forHTTPHeaderField:@"Content-Type"];
    NSMutableDictionary *parameters = [@{
        @"client_id": self.clientId,
        @"refresh_token": refreshToken,
        @"grant_type": @"refresh_token",
    } mutableCopy];
    if (self.clientSecret.length > 0) parameters[@"client_secret"] = self.clientSecret;
    request.HTTPBody = [[self formEncodedBody:parameters] dataUsingEncoding:NSUTF8StringEncoding];
    [[self.session dataTaskWithRequest:request completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
        if (error) {
            completion(nil, error.localizedDescription);
            return;
        }
        NSDictionary *json = [self jsonDictionary:data errorMessage:nil];
        NSString *token = [json[@"access_token"] isKindOfClass:[NSString class]] ? json[@"access_token"] : nil;
        if (token.length == 0) {
            NSString *message = [json[@"error_description"] isKindOfClass:[NSString class]] ? json[@"error_description"] : @"Google could not refresh the access token.";
            completion(nil, message);
            return;
        }
        NSNumber *expiresIn = [json[@"expires_in"] isKindOfClass:[NSNumber class]] ? json[@"expires_in"] : @3600;
        self.accessToken = token;
        self.accessTokenExpiry = [NSDate dateWithTimeIntervalSinceNow:expiresIn.doubleValue];
        completion(token, nil);
    }] resume];
}

- (void)performAuthorizedRequest:(NSURLRequest *)request
                            retry:(BOOL)retry
                        completion:(FDGoogleJSONCompletion)completion {
    [self accessTokenWithCompletion:^(NSString *token, NSString *errorMessage) {
        if (!token) {
            completion(nil, 0, errorMessage);
            return;
        }
        NSMutableURLRequest *authorized = [request mutableCopy];
        [authorized setValue:[NSString stringWithFormat:@"Bearer %@", token] forHTTPHeaderField:@"Authorization"];
        [[self.session dataTaskWithRequest:authorized completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
            if (error) {
                completion(nil, 0, error.localizedDescription);
                return;
            }
            NSInteger statusCode = [response isKindOfClass:[NSHTTPURLResponse class]] ? ((NSHTTPURLResponse *)response).statusCode : 0;
            NSDictionary *json = [self jsonDictionary:data errorMessage:nil];
            if (statusCode == 401 && !retry) {
                self.accessToken = nil;
                self.accessTokenExpiry = nil;
                [self performAuthorizedRequest:request retry:YES completion:completion];
                return;
            }
            if (statusCode < 200 || statusCode >= 300) {
                NSString *message = [json[@"error" ] isKindOfClass:[NSDictionary class]] && [json[@"error"][@"message"] isKindOfClass:[NSString class]]
                    ? json[@"error"][@"message"]
                    : @"Google Calendar returned an error.";
                completion(json, statusCode, message);
                return;
            }
            completion(json ?: @{}, statusCode, nil);
        }] resume];
    }];
}

- (NSDictionary *)jsonDictionary:(NSData *)data errorMessage:(NSString **)errorMessage {
    if (data.length == 0) return @{};
    NSError *error = nil;
    id object = [NSJSONSerialization JSONObjectWithData:data options:0 error:&error];
    if (![object isKindOfClass:[NSDictionary class]]) {
        if (errorMessage) *errorMessage = error.localizedDescription ?: @"The Google response was not valid JSON.";
        return @{};
    }
    return object;
}

- (NSString *)encodedPathComponent:(NSString *)value {
    return [value stringByAddingPercentEncodingWithAllowedCharacters:[NSCharacterSet URLPathAllowedCharacterSet]] ?: value;
}

- (NSString *)syncTokenKeyForCalendar:(NSString *)calendarId {
    NSString *encoded = [calendarId stringByAddingPercentEncodingWithAllowedCharacters:[NSCharacterSet alphanumericCharacterSet]] ?: calendarId;
    return [NSString stringWithFormat:@"googleCalendar.syncToken.%@", encoded];
}

- (void)calendarListWithCompletion:(FDGoogleCalendarCompletion)completion {
    if ([self refreshToken].length == 0) {
        completion([self errorWithCode:@"GOOGLE_NOT_CONNECTED" message:@"Connect Google Calendar before loading calendars."]);
        return;
    }
    NSURLComponents *components = [NSURLComponents componentsWithString:@"https://www.googleapis.com/calendar/v3/users/me/calendarList"];
    components.queryItems = @[
        [NSURLQueryItem queryItemWithName:@"showDeleted" value:@"false"],
        [NSURLQueryItem queryItemWithName:@"showHidden" value:@"true"],
        [NSURLQueryItem queryItemWithName:@"maxResults" value:@"250"],
    ];
    NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:components.URL];
    request.HTTPMethod = @"GET";
    [self performAuthorizedRequest:request retry:NO completion:^(NSDictionary *json, NSInteger statusCode, NSString *errorMessage) {
        if (errorMessage) {
            completion([self errorWithCode:@"GOOGLE_CALENDAR_LIST_FAILED" message:errorMessage]);
            return;
        }
        NSMutableArray *calendars = [NSMutableArray array];
        NSArray *items = [json[@"items"] isKindOfClass:[NSArray class]] ? json[@"items"] : @[];
        for (NSDictionary *item in items) {
            if (![item isKindOfClass:[NSDictionary class]]) continue;
            NSString *calendarId = [item[@"id"] isKindOfClass:[NSString class]] ? item[@"id"] : nil;
            if (calendarId.length == 0) continue;
            NSString *summary = [item[@"summaryOverride"] isKindOfClass:[NSString class]] && [item[@"summaryOverride"] length] > 0
                ? item[@"summaryOverride"]
                : ([item[@"summary"] isKindOfClass:[NSString class]] && [item[@"summary"] length] > 0 ? item[@"summary"] : calendarId);
            NSMutableDictionary *calendar = [NSMutableDictionary dictionaryWithDictionary:@{
                @"id": calendarId,
                @"summary": summary,
            }];
            if ([item[@"description"] isKindOfClass:[NSString class]]) calendar[@"description"] = item[@"description"];
            if ([item[@"primary"] isKindOfClass:[NSNumber class]]) calendar[@"primary"] = item[@"primary"];
            if ([item[@"selected"] isKindOfClass:[NSNumber class]]) calendar[@"selected"] = item[@"selected"];
            if ([item[@"backgroundColor"] isKindOfClass:[NSString class]]) calendar[@"backgroundColor"] = item[@"backgroundColor"];
            if ([item[@"accessRole"] isKindOfClass:[NSString class]]) calendar[@"accessRole"] = item[@"accessRole"];
            [calendars addObject:calendar];
        }
        completion([self successWithData:@{ @"calendars": calendars }]);
    }];
}

- (void)syncWithCompletion:(FDGoogleCalendarCompletion)completion {
    if ([self refreshToken].length == 0) {
        completion([self successWithData:@{
            @"connected": @NO,
            @"calendarId": self.calendarId ?: @"primary",
            @"events": @[],
            @"deleted": @[],
        }]);
        return;
    }
    NSMutableArray *calendarIds = [NSMutableArray array];
    for (NSString *calendarId in self.calendarIds) {
        if (calendarId.length > 0 && ![calendarIds containsObject:calendarId]) [calendarIds addObject:calendarId];
    }
    if (calendarIds.count == 0) [calendarIds addObject:self.calendarId ?: @"primary"];
    [self syncCalendars:calendarIds index:0 events:@[] deleted:@[] fullSync:self.fullSync completion:completion];
}

- (void)syncCalendars:(NSArray<NSString *> *)calendarIds
                index:(NSUInteger)index
               events:(NSArray *)events
              deleted:(NSArray *)deleted
             fullSync:(BOOL)fullSync
           completion:(FDGoogleCalendarCompletion)completion {
    if (index >= calendarIds.count) {
        [self.defaults setObject:[self isoDateString:[NSDate date]] forKey:FDGoogleLastSyncDefaultsKey];
        completion([self successWithData:@{
            @"connected": @YES,
            @"calendarId": calendarIds.firstObject ?: self.calendarId ?: @"primary",
            @"events": events,
            @"deleted": deleted,
            @"syncedAt": [self isoDateString:[NSDate date]],
        }]);
        return;
    }
    NSString *calendarId = calendarIds[index];
    NSString *syncToken = fullSync ? nil : [self.defaults stringForKey:[self syncTokenKeyForCalendar:calendarId]];
    [self fetchEventsForCalendar:calendarId syncToken:syncToken pageToken:nil items:@[] allowReset:YES completion:^(NSDictionary *result, NSString *errorMessage) {
        if (errorMessage) {
            completion([self errorWithCode:@"GOOGLE_CALENDAR_SYNC_FAILED" message:errorMessage]);
            return;
        }
        NSString *nextSyncToken = [result[@"nextSyncToken"] isKindOfClass:[NSString class]] ? result[@"nextSyncToken"] : nil;
        if (nextSyncToken.length > 0) [self.defaults setObject:nextSyncToken forKey:[self syncTokenKeyForCalendar:calendarId]];
        NSArray *nextEvents = [events arrayByAddingObjectsFromArray:[result[@"events"] isKindOfClass:[NSArray class]] ? result[@"events"] : @[]];
        NSArray *nextDeleted = [deleted arrayByAddingObjectsFromArray:[result[@"deleted"] isKindOfClass:[NSArray class]] ? result[@"deleted"] : @[]];
        [self syncCalendars:calendarIds index:index + 1 events:nextEvents deleted:nextDeleted fullSync:fullSync completion:completion];
    }];
}

- (void)fetchEventsForCalendar:(NSString *)calendarId
                     syncToken:(NSString *)syncToken
                     pageToken:(NSString *)pageToken
                         items:(NSArray *)items
                    allowReset:(BOOL)allowReset
                     completion:(void (^)(NSDictionary *result, NSString *errorMessage))completion {
    NSString *encodedCalendarId = [self encodedPathComponent:calendarId];
    NSString *urlString = [NSString stringWithFormat:@"https://www.googleapis.com/calendar/v3/calendars/%@/events", encodedCalendarId];
    NSURLComponents *components = [NSURLComponents componentsWithString:urlString];
    NSMutableArray *queryItems = [NSMutableArray arrayWithArray:@[
        [NSURLQueryItem queryItemWithName:@"singleEvents" value:@"true"],
        [NSURLQueryItem queryItemWithName:@"showDeleted" value:@"true"],
        [NSURLQueryItem queryItemWithName:@"maxResults" value:@"2500"],
    ]];
    if (syncToken.length > 0) {
        [queryItems addObject:[NSURLQueryItem queryItemWithName:@"syncToken" value:syncToken]];
    } else {
        [queryItems addObject:[NSURLQueryItem queryItemWithName:@"orderBy" value:@"startTime"]];
    }
    if (pageToken.length > 0) [queryItems addObject:[NSURLQueryItem queryItemWithName:@"pageToken" value:pageToken]];
    components.queryItems = queryItems;
    NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:components.URL];
    request.HTTPMethod = @"GET";
    [self performAuthorizedRequest:request retry:NO completion:^(NSDictionary *json, NSInteger statusCode, NSString *errorMessage) {
        if (statusCode == 410 && allowReset) {
            [self.defaults removeObjectForKey:[self syncTokenKeyForCalendar:calendarId]];
            [self fetchEventsForCalendar:calendarId syncToken:nil pageToken:nil items:@[] allowReset:NO completion:completion];
            return;
        }
        if (errorMessage) {
            completion(nil, errorMessage);
            return;
        }
        NSArray *pageItems = [json[@"items"] isKindOfClass:[NSArray class]] ? json[@"items"] : @[];
        NSArray *allItems = [items arrayByAddingObjectsFromArray:pageItems];
        NSString *nextPageToken = [json[@"nextPageToken"] isKindOfClass:[NSString class]] ? json[@"nextPageToken"] : nil;
        if (nextPageToken.length > 0) {
            [self fetchEventsForCalendar:calendarId syncToken:syncToken pageToken:nextPageToken items:allItems allowReset:allowReset completion:completion];
            return;
        }
        NSString *nextSyncToken = [json[@"nextSyncToken"] isKindOfClass:[NSString class]] ? json[@"nextSyncToken"] : nil;
        NSMutableArray *events = [NSMutableArray array];
        NSMutableArray *deleted = [NSMutableArray array];
        for (NSDictionary *item in allItems) {
            if (![item isKindOfClass:[NSDictionary class]]) continue;
            if ([item[@"status"] isEqualToString:@"cancelled"]) {
                NSDictionary *deletedEvent = [self normalizedDeletedEvent:item calendarId:calendarId];
                if (deletedEvent) [deleted addObject:deletedEvent];
            } else {
                NSDictionary *normalized = [self normalizedEvent:item calendarId:calendarId];
                if (!normalized) continue;
                [events addObject:normalized];
            }
        }
        completion(@{
            @"events": events,
            @"deleted": deleted,
            @"nextSyncToken": nextSyncToken ?: [NSNull null],
        }, nil);
    }];
}

- (NSString *)isoDateString:(NSDate *)date {
    NSISO8601DateFormatter *formatter = [NSISO8601DateFormatter new];
    formatter.formatOptions = NSISO8601DateFormatWithInternetDateTime;
    return [formatter stringFromDate:date];
}

- (NSDictionary *)normalizedEvent:(NSDictionary *)item calendarId:(NSString *)calendarId {
    NSString *eventId = [item[@"id"] isKindOfClass:[NSString class]] ? item[@"id"] : nil;
    if (eventId.length == 0) return nil;
    NSDictionary *start = [item[@"start"] isKindOfClass:[NSDictionary class]] ? item[@"start"] : @{};
    NSString *date = [start[@"date"] isKindOfClass:[NSString class]] ? start[@"date"] : nil;
    NSString *time = nil;
    NSString *dateTime = [start[@"dateTime"] isKindOfClass:[NSString class]] ? start[@"dateTime"] : nil;
    if (dateTime.length > 0) {
        NSISO8601DateFormatter *isoFormatter = [NSISO8601DateFormatter new];
        isoFormatter.formatOptions = NSISO8601DateFormatWithInternetDateTime | NSISO8601DateFormatWithFractionalSeconds;
        NSDate *parsed = [isoFormatter dateFromString:dateTime];
        if (!parsed) {
            isoFormatter.formatOptions = NSISO8601DateFormatWithInternetDateTime;
            parsed = [isoFormatter dateFromString:dateTime];
        }
        if (parsed) {
            NSDateFormatter *localFormatter = [NSDateFormatter new];
            localFormatter.locale = [NSLocale localeWithLocaleIdentifier:@"en_US_POSIX"];
            localFormatter.timeZone = [NSTimeZone localTimeZone];
            localFormatter.dateFormat = @"yyyy-MM-dd";
            date = [localFormatter stringFromDate:parsed];
            localFormatter.dateFormat = @"HH:mm";
            time = [localFormatter stringFromDate:parsed];
        }
    }
    if (date.length == 0) return nil;
    NSMutableDictionary *result = [NSMutableDictionary dictionaryWithDictionary:@{
        @"id": eventId,
        @"calendarId": calendarId,
        @"title": [item[@"summary"] isKindOfClass:[NSString class]] && [item[@"summary"] length] > 0 ? item[@"summary"] : @"(No title)",
        @"date": date,
    }];
    if (time.length > 0) result[@"time"] = time;
    if ([item[@"iCalUID"] isKindOfClass:[NSString class]]) result[@"iCalUID"] = item[@"iCalUID"];
    if ([item[@"etag"] isKindOfClass:[NSString class]]) result[@"etag"] = item[@"etag"];
    if ([item[@"updated"] isKindOfClass:[NSString class]]) result[@"updatedAt"] = item[@"updated"];
    NSDictionary *privateProperties = [item[@"extendedProperties"] isKindOfClass:[NSDictionary class]] ? item[@"extendedProperties"][@"private"] : nil;
    NSString *localId = [privateProperties[ @"focusdeskEventId" ] isKindOfClass:[NSString class]] ? privateProperties[@"focusdeskEventId"] : nil;
    if (localId.length > 0 && localId.doubleValue > 0) result[@"focusDeskEventId"] = @((NSInteger)localId.doubleValue);
    return result;
}

- (NSDictionary *)normalizedDeletedEvent:(NSDictionary *)item calendarId:(NSString *)calendarId {
    NSString *eventId = [item[@"id"] isKindOfClass:[NSString class]] ? item[@"id"] : nil;
    if (eventId.length == 0) return nil;
    NSMutableDictionary *result = [NSMutableDictionary dictionaryWithDictionary:@{
        @"id": eventId,
        @"calendarId": calendarId,
    }];
    if ([item[@"iCalUID"] isKindOfClass:[NSString class]]) result[@"iCalUID"] = item[@"iCalUID"];
    NSDictionary *extendedProperties = [item[@"extendedProperties"] isKindOfClass:[NSDictionary class]] ? item[@"extendedProperties"] : nil;
    NSDictionary *privateProperties = [extendedProperties[@"private"] isKindOfClass:[NSDictionary class]] ? extendedProperties[@"private"] : nil;
    NSString *localId = [privateProperties[@"focusdeskEventId"] isKindOfClass:[NSString class]] ? privateProperties[@"focusdeskEventId"] : nil;
    if (localId.length > 0 && localId.doubleValue > 0) result[@"focusDeskEventId"] = @((NSInteger)localId.doubleValue);
    return result;
}

- (NSDictionary *)googleEventResource:(NSDictionary *)event {
    NSString *date = [event[@"date"] isKindOfClass:[NSString class]] ? event[@"date"] : nil;
    NSString *time = [event[@"time"] isKindOfClass:[NSString class]] ? event[@"time"] : nil;
    NSString *title = [event[@"title"] isKindOfClass:[NSString class]] ? event[@"title"] : nil;
    NSNumber *localId = [event[@"id"] isKindOfClass:[NSNumber class]] ? event[@"id"] : nil;
    if (date.length == 0 || title.length == 0 || !localId) return nil;
    NSMutableDictionary *resource = [NSMutableDictionary dictionaryWithDictionary:@{
        @"summary": title,
        @"extendedProperties": @{ @"private": @{ @"focusdeskEventId": localId.stringValue } },
    }];
    NSDateFormatter *dateFormatter = [NSDateFormatter new];
    dateFormatter.locale = [NSLocale localeWithLocaleIdentifier:@"en_US_POSIX"];
    dateFormatter.timeZone = [NSTimeZone localTimeZone];
    if (time.length == 0 || [time isEqualToString:@"ALL DAY"]) {
        dateFormatter.dateFormat = @"yyyy-MM-dd";
        NSDate *startDate = [dateFormatter dateFromString:date];
        NSDate *endDate = [startDate dateByAddingTimeInterval:86400];
        resource[@"start"] = @{ @"date": date };
        resource[@"end"] = @{ @"date": [dateFormatter stringFromDate:endDate] };
        return resource;
    }
    dateFormatter.dateFormat = @"yyyy-MM-dd HH:mm";
    NSDate *startDate = [dateFormatter dateFromString:[NSString stringWithFormat:@"%@ %@", date, time]];
    if (!startDate) return nil;
    NSDate *endDate = [startDate dateByAddingTimeInterval:3600];
    dateFormatter.dateFormat = @"yyyy-MM-dd'T'HH:mm:ss";
    NSString *timeZone = [NSTimeZone localTimeZone].name ?: @"UTC";
    resource[@"start"] = @{ @"dateTime": [dateFormatter stringFromDate:startDate], @"timeZone": timeZone };
    resource[@"end"] = @{ @"dateTime": [dateFormatter stringFromDate:endDate], @"timeZone": timeZone };
    return resource;
}

- (void)invokeEventOperation:(NSString *)operation
                      payload:(NSDictionary *)payload
                   completion:(FDGoogleCalendarCompletion)completion {
    if ([self refreshToken].length == 0) {
        completion([self errorWithCode:@"GOOGLE_NOT_CONNECTED" message:@"Connect Google Calendar before writing events."]);
        return;
    }
    NSDictionary *event = [payload[@"event"] isKindOfClass:[NSDictionary class]] ? payload[@"event"] : nil;
    NSString *calendarId = [payload[@"calendarId"] isKindOfClass:[NSString class]] ? payload[@"calendarId"] : self.calendarId;
    if (!event || calendarId.length == 0) {
        completion([self errorWithCode:@"INVALID_GOOGLE_EVENT" message:@"A calendar ID and event are required."]);
        return;
    }
    if (![event[@"source"] isEqualToString:@"focusdesk"]) {
        completion([self errorWithCode:@"GOOGLE_WRITE_SUPPRESSED" message:@"Only FocusDesk-owned events may be written to Google Calendar."]);
        return;
    }
    NSDictionary *resource = [self googleEventResource:event];
    if (!resource) {
        completion([self errorWithCode:@"INVALID_GOOGLE_EVENT" message:@"An event requires an id, title, and date."]);
        return;
    }
    NSString *eventId = [event[@"googleEventId"] isKindOfClass:[NSString class]] ? event[@"googleEventId"] : nil;
    NSString *encodedCalendarId = [self encodedPathComponent:calendarId];
    NSString *path = [NSString stringWithFormat:@"https://www.googleapis.com/calendar/v3/calendars/%@/events", encodedCalendarId];
    if ([operation isEqualToString:@"update"]) {
        if (eventId.length == 0) {
            completion([self errorWithCode:@"GOOGLE_EVENT_ID_MISSING" message:@"An update requires the saved Google event ID."]);
            return;
        }
        path = [path stringByAppendingFormat:@"/%@", [self encodedPathComponent:eventId]];
    }
    if ([operation isEqualToString:@"delete"]) {
        if (eventId.length == 0) {
            completion([self errorWithCode:@"GOOGLE_EVENT_ID_MISSING" message:@"A delete requires the saved Google event ID."]);
            return;
        }
        path = [path stringByAppendingFormat:@"/%@", [self encodedPathComponent:eventId]];
    }
    NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:[NSURL URLWithString:path]];
    request.HTTPMethod = [operation isEqualToString:@"create"] ? @"POST" : ([operation isEqualToString:@"update"] ? @"PUT" : @"DELETE");
    if (![operation isEqualToString:@"delete"]) {
        request.HTTPBody = [NSJSONSerialization dataWithJSONObject:resource options:0 error:nil];
        [request setValue:@"application/json" forHTTPHeaderField:@"Content-Type"];
    }
    [self performAuthorizedRequest:request retry:NO completion:^(NSDictionary *json, NSInteger statusCode, NSString *errorMessage) {
        if (errorMessage) {
            completion([self errorWithCode:@"GOOGLE_CALENDAR_WRITE_FAILED" message:errorMessage]);
            return;
        }
        if ([operation isEqualToString:@"delete"]) {
            completion([self successWithData:@{ @"deletedId": event[@"id"] ?: @0 }]);
            return;
        }
        NSDictionary *normalized = [self normalizedEvent:json calendarId:calendarId];
        if (!normalized) {
            completion([self errorWithCode:@"GOOGLE_CALENDAR_RESPONSE_INVALID" message:@"Google returned an event FocusDesk could not read."]);
            return;
        }
        NSMutableDictionary *localEvent = [NSMutableDictionary dictionaryWithDictionary:@{
            @"id": event[@"id"],
            @"title": event[@"title"],
            @"date": event[@"date"],
            @"source": @"focusdesk",
            @"calendar": calendarId,
            @"googleCalendarId": calendarId,
            @"googleEventId": normalized[@"id"],
            @"syncStatus": @"synced",
        }];
        if (event[@"time"]) localEvent[@"time"] = event[@"time"];
        if (normalized[@"iCalUID"]) localEvent[@"googleICalUID"] = normalized[@"iCalUID"];
        if (normalized[@"etag"]) localEvent[@"googleETag"] = normalized[@"etag"];
        if (normalized[@"updatedAt"]) localEvent[@"googleUpdatedAt"] = normalized[@"updatedAt"];
        completion([self successWithData:@{ @"event": localEvent }]);
    }];
}

- (void)disconnectWithCompletion:(FDGoogleCalendarCompletion)completion {
    [self deleteRefreshToken];
    [self.defaults removeObjectForKey:FDGoogleClientIDDefaultsKey];
    [self.defaults removeObjectForKey:FDGoogleScopesDefaultsKey];
    [self.defaults removeObjectForKey:FDGoogleLastSyncDefaultsKey];
    NSString *prefix = @"googleCalendar.syncToken.";
    for (NSString *key in self.defaults.dictionaryRepresentation.allKeys) {
        if ([key hasPrefix:prefix]) [self.defaults removeObjectForKey:key];
    }
    completion([self successWithData:@{ @"disconnected": @YES }]);
}

@end
