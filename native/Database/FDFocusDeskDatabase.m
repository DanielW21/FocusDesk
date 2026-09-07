#import "FDFocusDeskDatabase.h"

#import <sqlite3.h>

static NSInteger const FDFocusDeskDatabaseSchemaVersion = 1;

@interface FDFocusDeskDatabase ()
@property (assign) sqlite3 *database;
@property (copy) NSString *databasePath;
@property (copy) NSString *initializationError;
@property (strong) dispatch_queue_t executionQueue;
@end

@implementation FDFocusDeskDatabase

- (instancetype)init {
    self = [super init];
    if (self) {
        _executionQueue = dispatch_queue_create("com.danielwu.focusdesk.database", DISPATCH_QUEUE_SERIAL);
        dispatch_sync(_executionQueue, ^{
            [self openDatabase];
        });
    }
    return self;
}

- (void)dealloc {
    dispatch_sync(self.executionQueue, ^{
        if (self.database) {
            sqlite3_close(self.database);
            self.database = NULL;
        }
    });
}

- (void)invokeOperation:(NSString *)operation
                payload:(NSDictionary *)payload
             completion:(FDFocusDeskDatabaseCompletion)completion {
    dispatch_async(self.executionQueue, ^{
        NSDictionary *response;
        if (self.initializationError.length > 0) {
            response = [self errorWithCode:@"FOCUSDESK_DATABASE_UNAVAILABLE"
                                   message:self.initializationError];
        } else if ([operation isEqualToString:@"health"]) {
            response = [self healthResponse];
        } else if ([operation isEqualToString:@"bootstrap"]) {
            response = [self bootstrapTasks:payload[@"tasks"]];
        } else if ([operation isEqualToString:@"list"]) {
            response = [self listTasks];
        } else if ([operation isEqualToString:@"save"]) {
            response = [self saveTask:payload];
        } else if ([operation isEqualToString:@"delete"]) {
            response = [self deleteTask:payload];
        } else {
            response = [self errorWithCode:@"UNKNOWN_DATABASE_OPERATION"
                                   message:[NSString stringWithFormat:@"Unknown FocusDesk database operation: %@", operation]];
        }
        dispatch_async(dispatch_get_main_queue(), ^{
            completion(response);
        });
    });
}

- (void)openDatabase {
    NSFileManager *fileManager = [NSFileManager defaultManager];
    NSError *directoryError = nil;
    NSURL *applicationSupport = [fileManager URLForDirectory:NSApplicationSupportDirectory
                                                     inDomain:NSUserDomainMask
                                            appropriateForURL:nil
                                                       create:YES
                                                        error:&directoryError];
    if (!applicationSupport) {
        self.initializationError = directoryError.localizedDescription ?: @"FocusDesk could not locate Application Support.";
        return;
    }

    NSURL *directory = [applicationSupport URLByAppendingPathComponent:@"FocusDesk" isDirectory:YES];
    if (![fileManager createDirectoryAtURL:directory
               withIntermediateDirectories:YES
                                attributes:nil
                                     error:&directoryError]) {
        self.initializationError = directoryError.localizedDescription ?: @"FocusDesk could not create its data directory.";
        return;
    }

    NSURL *databaseURL = [directory URLByAppendingPathComponent:@"focusdesk.sqlite3"];
    self.databasePath = databaseURL.path;

    int result = sqlite3_open_v2(databaseURL.fileSystemRepresentation,
                                 &_database,
                                 SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX,
                                 NULL);
    if (result != SQLITE_OK) {
        self.initializationError = [self sqliteMessage];
        if (self.database) {
            sqlite3_close(self.database);
            self.database = NULL;
        }
        return;
    }

    char *errorMessage = NULL;
    const char *schemaSQL =
        "PRAGMA journal_mode = WAL;"
        "PRAGMA foreign_keys = ON;"
        "CREATE TABLE IF NOT EXISTS metadata ("
            "key TEXT PRIMARY KEY NOT NULL,"
            "value TEXT NOT NULL"
        ");"
        "CREATE TABLE IF NOT EXISTS tasks ("
            "id INTEGER PRIMARY KEY NOT NULL,"
            "title TEXT NOT NULL,"
            "done INTEGER NOT NULL DEFAULT 0 CHECK(done IN (0, 1)),"
            "tag TEXT NOT NULL,"
            "date TEXT NOT NULL,"
            "time TEXT,"
            "priority TEXT,"
            "created_at TEXT NOT NULL,"
            "updated_at TEXT NOT NULL"
        ");"
        "CREATE INDEX IF NOT EXISTS tasks_date_index ON tasks(date, done);"
        "INSERT OR IGNORE INTO metadata(key, value) VALUES ('schema_version', '1');";
    result = sqlite3_exec(self.database, schemaSQL, NULL, NULL, &errorMessage);
    if (result != SQLITE_OK) {
        self.initializationError = errorMessage
            ? [NSString stringWithUTF8String:errorMessage]
            : [self sqliteMessage];
        sqlite3_free(errorMessage);
    }
}

- (NSDictionary *)healthResponse {
    sqlite3_stmt *statement = NULL;
    int result = sqlite3_prepare_v2(self.database, "SELECT COUNT(*) FROM tasks", -1, &statement, NULL);
    if (result != SQLITE_OK) return [self sqliteErrorWithCode:@"FOCUSDESK_DATABASE_HEALTH_FAILED"];

    NSInteger taskCount = 0;
    if (sqlite3_step(statement) == SQLITE_ROW) taskCount = sqlite3_column_int(statement, 0);
    sqlite3_finalize(statement);
    return @{
        @"ok": @YES,
        @"data": @{
            @"schemaVersion": @(FDFocusDeskDatabaseSchemaVersion),
            @"path": self.databasePath ?: @"",
            @"taskCount": @(taskCount),
        },
    };
}

- (NSDictionary *)bootstrapTasks:(id)rawTasks {
    if (![rawTasks isKindOfClass:[NSArray class]]) {
        return [self errorWithCode:@"INVALID_TASKS" message:@"The bootstrap task list must be an array."];
    }

    char *errorMessage = NULL;
    if (sqlite3_exec(self.database, "BEGIN IMMEDIATE TRANSACTION", NULL, NULL, &errorMessage) != SQLITE_OK) {
        NSDictionary *response = [self errorWithCode:@"FOCUSDESK_DATABASE_WRITE_FAILED"
                                              message:errorMessage ? [NSString stringWithUTF8String:errorMessage] : [self sqliteMessage]];
        sqlite3_free(errorMessage);
        return response;
    }

    const char *sql = "INSERT OR IGNORE INTO tasks(id, title, done, tag, date, time, priority, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)";
    BOOL success = YES;
    NSString *failureMessage = nil;
    for (id candidate in (NSArray *)rawTasks) {
        if (![candidate isKindOfClass:[NSDictionary class]]) continue;
        NSDictionary *task = (NSDictionary *)candidate;
        if (![self bindTask:task toSQL:sql statementBlock:^int(sqlite3_stmt *statement) {
            return sqlite3_step(statement);
        }]) {
            success = NO;
            failureMessage = [self sqliteMessage];
            break;
        }
    }

    if (success) {
        if (sqlite3_exec(self.database, "COMMIT", NULL, NULL, &errorMessage) != SQLITE_OK) {
            success = NO;
            failureMessage = errorMessage ? [NSString stringWithUTF8String:errorMessage] : [self sqliteMessage];
        }
    }
    if (!success) {
        sqlite3_exec(self.database, "ROLLBACK", NULL, NULL, NULL);
        NSDictionary *response = [self errorWithCode:@"FOCUSDESK_DATABASE_WRITE_FAILED"
                                              message:failureMessage ?: @"Could not import FocusDesk tasks."];
        sqlite3_free(errorMessage);
        return response;
    }
    sqlite3_free(errorMessage);
    return [self listTasks];
}

- (NSDictionary *)listTasks {
    const char *sql = "SELECT id, title, done, tag, date, time, priority FROM tasks ORDER BY date ASC, CASE WHEN time IS NULL OR time = '' THEN '99:99' ELSE time END ASC, id ASC";
    sqlite3_stmt *statement = NULL;
    if (sqlite3_prepare_v2(self.database, sql, -1, &statement, NULL) != SQLITE_OK) {
        return [self sqliteErrorWithCode:@"FOCUSDESK_DATABASE_READ_FAILED"];
    }

    NSMutableArray *tasks = [NSMutableArray array];
    while (sqlite3_step(statement) == SQLITE_ROW) {
        NSMutableDictionary *task = [NSMutableDictionary dictionary];
        task[@"id"] = @(sqlite3_column_int64(statement, 0));
        task[@"title"] = [self stringColumn:statement index:1] ?: @"";
        task[@"done"] = @(sqlite3_column_int(statement, 2) != 0);
        task[@"tag"] = [self stringColumn:statement index:3] ?: @"Task";
        task[@"date"] = [self stringColumn:statement index:4] ?: @"";
        NSString *time = [self stringColumn:statement index:5];
        NSString *priority = [self stringColumn:statement index:6];
        if (time.length > 0) task[@"time"] = time;
        if (priority.length > 0) task[@"priority"] = priority;
        [tasks addObject:task];
    }
    sqlite3_finalize(statement);
    return @{ @"ok": @YES, @"data": @{ @"tasks": tasks } };
}

- (NSDictionary *)saveTask:(NSDictionary *)task {
    NSNumber *taskId = [task[@"id"] isKindOfClass:[NSNumber class]] ? task[@"id"] : nil;
    if (!taskId || ![task[@"title"] isKindOfClass:[NSString class]] ||
        ![task[@"tag"] isKindOfClass:[NSString class]] ||
        ![task[@"date"] isKindOfClass:[NSString class]]) {
        return [self errorWithCode:@"INVALID_TASK" message:@"A task requires id, title, tag, and date."];
    }

    const char *sql = "INSERT INTO tasks(id, title, done, tag, date, time, priority, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET title = excluded.title, done = excluded.done, tag = excluded.tag, date = excluded.date, time = excluded.time, priority = excluded.priority, updated_at = excluded.updated_at";
    BOOL prepared = [self bindTask:task toSQL:sql statementBlock:^int(sqlite3_stmt *statement) {
        return sqlite3_step(statement);
    }];
    if (!prepared) {
        return [self sqliteErrorWithCode:@"FOCUSDESK_DATABASE_WRITE_FAILED"];
    }

    NSDictionary *result = [self listTaskById:taskId.longLongValue];
    return result ?: [self errorWithCode:@"TASK_NOT_FOUND" message:@"The task was not saved."];
}

- (NSDictionary *)deleteTask:(NSDictionary *)payload {
    NSNumber *taskId = [payload[@"id"] isKindOfClass:[NSNumber class]] ? payload[@"id"] : nil;
    if (!taskId) return [self errorWithCode:@"INVALID_TASK_ID" message:@"A numeric task id is required."];

    sqlite3_stmt *statement = NULL;
    if (sqlite3_prepare_v2(self.database, "DELETE FROM tasks WHERE id = ?", -1, &statement, NULL) != SQLITE_OK) {
        return [self sqliteErrorWithCode:@"FOCUSDESK_DATABASE_WRITE_FAILED"];
    }
    sqlite3_bind_int64(statement, 1, taskId.longLongValue);
    int result = sqlite3_step(statement);
    sqlite3_finalize(statement);
    if (result != SQLITE_DONE) return [self sqliteErrorWithCode:@"FOCUSDESK_DATABASE_WRITE_FAILED"];
    return @{ @"ok": @YES, @"data": @{ @"deletedId": taskId } };
}

- (NSDictionary *)listTaskById:(long long)taskId {
    sqlite3_stmt *statement = NULL;
    const char *sql = "SELECT id, title, done, tag, date, time, priority FROM tasks WHERE id = ?";
    if (sqlite3_prepare_v2(self.database, sql, -1, &statement, NULL) != SQLITE_OK) return nil;
    sqlite3_bind_int64(statement, 1, taskId);
    if (sqlite3_step(statement) != SQLITE_ROW) {
        sqlite3_finalize(statement);
        return nil;
    }
    NSMutableDictionary *task = [NSMutableDictionary dictionary];
    task[@"id"] = @(sqlite3_column_int64(statement, 0));
    task[@"title"] = [self stringColumn:statement index:1] ?: @"";
    task[@"done"] = @(sqlite3_column_int(statement, 2) != 0);
    task[@"tag"] = [self stringColumn:statement index:3] ?: @"Task";
    task[@"date"] = [self stringColumn:statement index:4] ?: @"";
    NSString *time = [self stringColumn:statement index:5];
    NSString *priority = [self stringColumn:statement index:6];
    if (time.length > 0) task[@"time"] = time;
    if (priority.length > 0) task[@"priority"] = priority;
    sqlite3_finalize(statement);
    return @{ @"ok": @YES, @"data": @{ @"task": task } };
}

- (BOOL)bindTask:(NSDictionary *)task
          toSQL:(const char *)sql
 statementBlock:(int (^)(sqlite3_stmt *statement))block {
    sqlite3_stmt *statement = NULL;
    if (sqlite3_prepare_v2(self.database, sql, -1, &statement, NULL) != SQLITE_OK) return NO;

    NSNumber *taskId = task[@"id"];
    NSString *title = task[@"title"];
    NSString *tag = task[@"tag"];
    NSString *date = task[@"date"];
    NSString *time = [task[@"time"] isKindOfClass:[NSString class]] ? task[@"time"] : nil;
    NSString *priority = [task[@"priority"] isKindOfClass:[NSString class]] ? task[@"priority"] : nil;
    NSString *timestamp = [self timestamp];
    sqlite3_bind_int64(statement, 1, taskId.longLongValue);
    sqlite3_bind_text(statement, 2, title.UTF8String, -1, SQLITE_TRANSIENT);
    sqlite3_bind_int(statement, 3, [task[@"done"] boolValue] ? 1 : 0);
    sqlite3_bind_text(statement, 4, tag.UTF8String, -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(statement, 5, date.UTF8String, -1, SQLITE_TRANSIENT);
    if (time.length > 0) sqlite3_bind_text(statement, 6, time.UTF8String, -1, SQLITE_TRANSIENT);
    else sqlite3_bind_null(statement, 6);
    if (priority.length > 0) sqlite3_bind_text(statement, 7, priority.UTF8String, -1, SQLITE_TRANSIENT);
    else sqlite3_bind_null(statement, 7);
    sqlite3_bind_text(statement, 8, timestamp.UTF8String, -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(statement, 9, timestamp.UTF8String, -1, SQLITE_TRANSIENT);
    int result = block(statement);
    int finalizeResult = sqlite3_finalize(statement);
    return result == SQLITE_DONE && finalizeResult == SQLITE_OK;
}

- (NSString *)timestamp {
    return [[NSDate date] description];
}

- (NSString *)stringColumn:(sqlite3_stmt *)statement index:(int)index {
    const unsigned char *value = sqlite3_column_text(statement, index);
    return value ? [NSString stringWithUTF8String:(const char *)value] : nil;
}

- (NSString *)sqliteMessage {
    const char *message = self.database ? sqlite3_errmsg(self.database) : NULL;
    return message ? [NSString stringWithUTF8String:message] : @"SQLite returned an unknown error.";
}

- (NSDictionary *)sqliteErrorWithCode:(NSString *)code {
    return [self errorWithCode:code message:[self sqliteMessage]];
}

- (NSDictionary *)errorWithCode:(NSString *)code message:(NSString *)message {
    return @{
        @"ok": @NO,
        @"error": @{ @"code": code, @"message": message },
    };
}

@end
