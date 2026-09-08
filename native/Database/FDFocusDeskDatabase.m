#import "FDFocusDeskDatabase.h"

#import <sqlite3.h>

static NSInteger const FDFocusDeskDatabaseSchemaVersion = 2;

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
        } else if ([operation isEqualToString:@"get"]) {
            response = [self getTask:payload];
        } else if ([operation isEqualToString:@"save"]) {
            response = [self saveTask:payload];
        } else if ([operation isEqualToString:@"delete"]) {
            response = [self deleteTask:payload];
        } else if ([operation isEqualToString:@"workspace.load"]) {
            response = [self loadWorkspace];
        } else if ([operation isEqualToString:@"workspace.save"]) {
            response = [self saveWorkspace:payload];
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

    sqlite3_busy_timeout(self.database, 5000);
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
            "recurrence_json TEXT,"
            "completed_dates TEXT NOT NULL DEFAULT '[]',"
            "created_at TEXT NOT NULL,"
            "updated_at TEXT NOT NULL"
        ");"
        "CREATE INDEX IF NOT EXISTS tasks_date_index ON tasks(date, done);"
        "CREATE TABLE IF NOT EXISTS workspace_state ("
            "id INTEGER PRIMARY KEY CHECK(id = 1),"
            "document_json TEXT NOT NULL,"
            "updated_at TEXT NOT NULL"
        ");"
        "INSERT OR IGNORE INTO metadata(key, value) VALUES ('schema_version', '2');";
    char *errorMessage = NULL;
    result = sqlite3_exec(self.database, schemaSQL, NULL, NULL, &errorMessage);
    if (result != SQLITE_OK) {
        self.initializationError = errorMessage
            ? [NSString stringWithUTF8String:errorMessage]
            : [self sqliteMessage];
        sqlite3_free(errorMessage);
        return;
    }

    [self migrateSchemaIfNeeded];
}

- (void)migrateSchemaIfNeeded {
    BOOL hasRecurrenceColumn = [self tasksTableHasColumn:@"recurrence_json"];
    BOOL hasCompletedDatesColumn = [self tasksTableHasColumn:@"completed_dates"];
    if (self.initializationError.length > 0) return;

    NSString *failureMessage = nil;
    if (![self executeSQL:"BEGIN IMMEDIATE TRANSACTION" failureMessage:&failureMessage]) {
        self.initializationError = failureMessage ?: @"FocusDesk could not begin its schema migration.";
        return;
    }

    BOOL success = YES;
    if (!hasRecurrenceColumn) {
        success = [self executeSQL:"ALTER TABLE tasks ADD COLUMN recurrence_json TEXT"
                    failureMessage:&failureMessage];
    }
    if (success && !hasCompletedDatesColumn) {
        success = [self executeSQL:"ALTER TABLE tasks ADD COLUMN completed_dates TEXT NOT NULL DEFAULT '[]'"
                    failureMessage:&failureMessage];
    }
    if (success) {
        success = [self executeSQL:
                   "INSERT INTO metadata(key, value) VALUES ('schema_version', '2') "
                   "ON CONFLICT(key) DO UPDATE SET value = excluded.value"
                    failureMessage:&failureMessage];
    }
    if (success) {
        success = [self executeSQL:"COMMIT" failureMessage:&failureMessage];
    }

    if (!success) {
        sqlite3_exec(self.database, "ROLLBACK", NULL, NULL, NULL);
        self.initializationError = failureMessage ?: [self sqliteMessage];
    }
}

- (BOOL)tasksTableHasColumn:(NSString *)columnName {
    sqlite3_stmt *statement = NULL;
    if (sqlite3_prepare_v2(self.database, "PRAGMA table_info(tasks)", -1, &statement, NULL) != SQLITE_OK) {
        self.initializationError = [self sqliteMessage];
        return NO;
    }

    BOOL found = NO;
    int result = SQLITE_OK;
    while ((result = sqlite3_step(statement)) == SQLITE_ROW) {
        NSString *name = [self stringColumn:statement index:1];
        if ([name isEqualToString:columnName]) {
            found = YES;
            break;
        }
    }
    int finalizeResult = sqlite3_finalize(statement);
    if (!found && result != SQLITE_DONE) {
        self.initializationError = [self sqliteMessage];
        return NO;
    }
    if (finalizeResult != SQLITE_OK && self.initializationError.length == 0) {
        self.initializationError = [self sqliteMessage];
    }
    return found;
}

- (BOOL)executeSQL:(const char *)sql failureMessage:(NSString **)failureMessage {
    char *errorMessage = NULL;
    int result = sqlite3_exec(self.database, sql, NULL, NULL, &errorMessage);
    if (result == SQLITE_OK) {
        sqlite3_free(errorMessage);
        return YES;
    }

    NSString *message = errorMessage
        ? [NSString stringWithUTF8String:errorMessage]
        : [self sqliteMessage];
    sqlite3_free(errorMessage);
    if (failureMessage) *failureMessage = message;
    return NO;
}

- (NSDictionary *)loadWorkspace {
    sqlite3_stmt *statement = NULL;
    if (sqlite3_prepare_v2(self.database,
                           "SELECT document_json FROM workspace_state WHERE id = 1",
                           -1, &statement, NULL) != SQLITE_OK) {
        return [self sqliteErrorWithCode:@"FOCUSDESK_WORKSPACE_READ_FAILED"];
    }

    NSDictionary *document = nil;
    int result = sqlite3_step(statement);
    if (result == SQLITE_ROW) {
        NSString *json = [self stringColumn:statement index:0];
        NSData *data = [json dataUsingEncoding:NSUTF8StringEncoding];
        id parsed = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
        if ([parsed isKindOfClass:[NSDictionary class]]) document = parsed;
    }
    sqlite3_finalize(statement);
    if (result != SQLITE_ROW && result != SQLITE_DONE) {
        return [self sqliteErrorWithCode:@"FOCUSDESK_WORKSPACE_READ_FAILED"];
    }
    if (result == SQLITE_ROW && !document) {
        return [self errorWithCode:@"INVALID_WORKSPACE" message:@"The saved workspace is unreadable. It has not been overwritten."];
    }
    return @{ @"ok": @YES, @"data": document ? @{ @"document": document } : @{} };
}

- (NSDictionary *)saveWorkspace:(NSDictionary *)payload {
    NSDictionary *document = [payload[@"document"] isKindOfClass:[NSDictionary class]]
        ? payload[@"document"]
        : nil;
    if (!document) return [self errorWithCode:@"INVALID_WORKSPACE" message:@"The workspace document must be an object."];

    NSError *serializationError = nil;
    NSData *data = [NSJSONSerialization dataWithJSONObject:document options:0 error:&serializationError];
    if (!data) return [self errorWithCode:@"INVALID_WORKSPACE" message:serializationError.localizedDescription ?: @"The workspace document could not be serialized."];

    NSString *json = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
    NSString *updatedAt = [document[@"updatedAt"] isKindOfClass:[NSString class]] ? document[@"updatedAt"] : @"";
    sqlite3_stmt *statement = NULL;
    const char *sql = "INSERT INTO workspace_state(id, document_json, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET document_json = excluded.document_json, updated_at = excluded.updated_at";
    if (sqlite3_prepare_v2(self.database, sql, -1, &statement, NULL) != SQLITE_OK) return [self sqliteErrorWithCode:@"FOCUSDESK_WORKSPACE_WRITE_FAILED"];
    BOOL bound = sqlite3_bind_text(statement, 1, json.UTF8String, -1, SQLITE_TRANSIENT) == SQLITE_OK &&
        sqlite3_bind_text(statement, 2, updatedAt.UTF8String, -1, SQLITE_TRANSIENT) == SQLITE_OK;
    if (!bound) {
        sqlite3_finalize(statement);
        return [self sqliteErrorWithCode:@"FOCUSDESK_WORKSPACE_WRITE_FAILED"];
    }
    int result = sqlite3_step(statement);
    sqlite3_finalize(statement);
    return result == SQLITE_DONE
        ? @{ @"ok": @YES, @"data": @{ @"saved": @YES } }
        : [self sqliteErrorWithCode:@"FOCUSDESK_WORKSPACE_WRITE_FAILED"];
}

- (NSDictionary *)healthResponse {
    sqlite3_stmt *statement = NULL;
    int result = sqlite3_prepare_v2(self.database, "SELECT COUNT(*) FROM tasks", -1, &statement, NULL);
    if (result != SQLITE_OK) return [self sqliteErrorWithCode:@"FOCUSDESK_DATABASE_HEALTH_FAILED"];

    result = sqlite3_step(statement);
    if (result != SQLITE_ROW) {
        sqlite3_finalize(statement);
        return [self sqliteErrorWithCode:@"FOCUSDESK_DATABASE_HEALTH_FAILED"];
    }
    NSInteger taskCount = sqlite3_column_int(statement, 0);
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

    NSMutableArray *normalizedTasks = [NSMutableArray array];
    for (id candidate in (NSArray *)rawTasks) {
        if (![candidate isKindOfClass:[NSDictionary class]]) {
            return [self errorWithCode:@"INVALID_TASK" message:@"Every bootstrap task must be an object."];
        }
        NSString *failureMessage = nil;
        NSDictionary *normalizedTask = [self normalizedTask:candidate errorMessage:&failureMessage];
        if (!normalizedTask) {
            return [self errorWithCode:@"INVALID_TASK" message:failureMessage ?: @"The bootstrap task is invalid."];
        }
        [normalizedTasks addObject:normalizedTask];
    }

    NSString *failureMessage = nil;
    if (![self executeSQL:"BEGIN IMMEDIATE TRANSACTION" failureMessage:&failureMessage]) {
        return [self errorWithCode:@"FOCUSDESK_DATABASE_WRITE_FAILED"
                           message:failureMessage ?: @"Could not begin the task import."];
    }

    const char *sql = "INSERT OR IGNORE INTO tasks(id, title, done, tag, date, time, priority, recurrence_json, completed_dates, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
    BOOL success = YES;
    for (NSDictionary *task in normalizedTasks) {
        if (![self bindTask:task toSQL:sql statementBlock:^int(sqlite3_stmt *statement) {
            return sqlite3_step(statement);
        }]) {
            success = NO;
            failureMessage = [self sqliteMessage];
            break;
        }
    }

    if (success && ![self executeSQL:"COMMIT" failureMessage:&failureMessage]) {
        success = NO;
    }
    if (!success) {
        [self executeSQL:"ROLLBACK" failureMessage:nil];
        return [self errorWithCode:@"FOCUSDESK_DATABASE_WRITE_FAILED"
                           message:failureMessage ?: @"Could not import FocusDesk tasks."];
    }
    return [self listTasks];
}

- (NSDictionary *)listTasks {
    const char *sql = "SELECT id, title, done, tag, date, time, priority, recurrence_json, completed_dates FROM tasks ORDER BY date ASC, CASE WHEN time IS NULL OR time = '' THEN '99:99' ELSE time END ASC, id ASC";
    sqlite3_stmt *statement = NULL;
    if (sqlite3_prepare_v2(self.database, sql, -1, &statement, NULL) != SQLITE_OK) {
        return [self sqliteErrorWithCode:@"FOCUSDESK_DATABASE_READ_FAILED"];
    }

    NSMutableArray *tasks = [NSMutableArray array];
    int result = SQLITE_OK;
    while ((result = sqlite3_step(statement)) == SQLITE_ROW) {
        [tasks addObject:[self taskFromStatement:statement]];
    }
    sqlite3_finalize(statement);
    if (result != SQLITE_DONE) {
        return [self sqliteErrorWithCode:@"FOCUSDESK_DATABASE_READ_FAILED"];
    }
    return @{ @"ok": @YES, @"data": @{ @"tasks": tasks } };
}

- (NSDictionary *)getTask:(NSDictionary *)payload {
    NSNumber *taskId = [payload[@"id"] isKindOfClass:[NSNumber class]] ? payload[@"id"] : nil;
    if (!taskId) return [self errorWithCode:@"INVALID_TASK_ID" message:@"A numeric task id is required."];

    NSDictionary *task = [self listTaskById:taskId.longLongValue];
    return task ?: [self errorWithCode:@"TASK_NOT_FOUND" message:@"The requested task was not found."];
}

- (NSDictionary *)saveTask:(NSDictionary *)task {
    NSNumber *taskId = [task[@"id"] isKindOfClass:[NSNumber class]] ? task[@"id"] : nil;
    if (!taskId || ![task[@"title"] isKindOfClass:[NSString class]] ||
        ![task[@"tag"] isKindOfClass:[NSString class]] ||
        ![task[@"date"] isKindOfClass:[NSString class]]) {
        return [self errorWithCode:@"INVALID_TASK" message:@"A task requires id, title, tag, and date."];
    }

    // Older callers do not send the new metadata. Preserve it when updating an
    // existing row so a partial save cannot erase recurrence state.
    NSMutableDictionary *taskToSave = [task mutableCopy];
    NSDictionary *existingResponse = [self listTaskById:taskId.longLongValue];
    NSDictionary *existingTask = existingResponse[@"data"][@"task"];
    if ([existingTask isKindOfClass:[NSDictionary class]]) {
        if (![taskToSave objectForKey:@"recurrence"]) {
            taskToSave[@"recurrence"] = existingTask[@"recurrence"] ?: [NSNull null];
        }
        if (![taskToSave objectForKey:@"completedDates"]) {
            taskToSave[@"completedDates"] = existingTask[@"completedDates"] ?: @[];
        }
    }

    NSString *failureMessage = nil;
    NSDictionary *normalizedTask = [self normalizedTask:taskToSave errorMessage:&failureMessage];
    if (!normalizedTask) {
        return [self errorWithCode:@"INVALID_TASK" message:failureMessage ?: @"The task is invalid."];
    }

    const char *sql =
        "INSERT INTO tasks(id, title, done, tag, date, time, priority, recurrence_json, completed_dates, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
        "ON CONFLICT(id) DO UPDATE SET title = excluded.title, done = excluded.done, tag = excluded.tag, date = excluded.date, time = excluded.time, priority = excluded.priority, recurrence_json = excluded.recurrence_json, completed_dates = excluded.completed_dates, updated_at = excluded.updated_at";
    BOOL saved = [self bindTask:normalizedTask toSQL:sql statementBlock:^int(sqlite3_stmt *statement) {
        return sqlite3_step(statement);
    }];
    if (!saved) {
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
    if (sqlite3_bind_int64(statement, 1, taskId.longLongValue) != SQLITE_OK) {
        sqlite3_finalize(statement);
        return [self sqliteErrorWithCode:@"FOCUSDESK_DATABASE_WRITE_FAILED"];
    }
    int result = sqlite3_step(statement);
    sqlite3_finalize(statement);
    if (result != SQLITE_DONE) return [self sqliteErrorWithCode:@"FOCUSDESK_DATABASE_WRITE_FAILED"];
    return @{ @"ok": @YES, @"data": @{ @"deletedId": taskId } };
}

- (NSDictionary *)listTaskById:(long long)taskId {
    sqlite3_stmt *statement = NULL;
    const char *sql = "SELECT id, title, done, tag, date, time, priority, recurrence_json, completed_dates FROM tasks WHERE id = ?";
    if (sqlite3_prepare_v2(self.database, sql, -1, &statement, NULL) != SQLITE_OK) return nil;
    if (sqlite3_bind_int64(statement, 1, taskId) != SQLITE_OK) {
        sqlite3_finalize(statement);
        return nil;
    }
    int result = sqlite3_step(statement);
    if (result != SQLITE_ROW) {
        sqlite3_finalize(statement);
        return nil;
    }
    NSDictionary *task = [self taskFromStatement:statement];
    sqlite3_finalize(statement);
    return @{ @"ok": @YES, @"data": @{ @"task": task } };
}

- (NSDictionary *)taskFromStatement:(sqlite3_stmt *)statement {
    NSMutableDictionary *task = [NSMutableDictionary dictionary];
    task[@"id"] = @(sqlite3_column_int64(statement, 0));
    task[@"title"] = [self stringColumn:statement index:1] ?: @"";
    task[@"done"] = sqlite3_column_int(statement, 2) != 0 ? @YES : @NO;
    task[@"tag"] = [self stringColumn:statement index:3] ?: @"Task";
    task[@"date"] = [self stringColumn:statement index:4] ?: @"";
    NSString *time = [self stringColumn:statement index:5];
    NSString *priority = [self stringColumn:statement index:6];
    if (time.length > 0) task[@"time"] = time;
    if (priority.length > 0) task[@"priority"] = priority;

    NSString *recurrenceJSON = [self stringColumn:statement index:7];
    NSDictionary *recurrence = [self recurrenceFromJSON:recurrenceJSON];
    task[@"recurrence"] = recurrence ?: [NSNull null];
    task[@"completedDates"] = [self completedDatesFromJSON:[self stringColumn:statement index:8]] ?: @[];
    return task;
}

- (NSDictionary *)normalizedTask:(NSDictionary *)task errorMessage:(NSString **)errorMessage {
    if (![task[@"id"] isKindOfClass:[NSNumber class]] ||
        ![task[@"title"] isKindOfClass:[NSString class]] ||
        ![task[@"tag"] isKindOfClass:[NSString class]] ||
        ![task[@"date"] isKindOfClass:[NSString class]]) {
        if (errorMessage) *errorMessage = @"A task requires numeric id, title, tag, and date values.";
        return nil;
    }
    if (task[@"done"] && ![task[@"done"] isKindOfClass:[NSNumber class]]) {
        if (errorMessage) *errorMessage = @"Task done must be a boolean value.";
        return nil;
    }

    id rawRecurrence = task[@"recurrence"];
    NSDictionary *recurrence = nil;
    if (rawRecurrence && rawRecurrence != [NSNull null]) {
        recurrence = [self normalizedRecurrence:rawRecurrence errorMessage:errorMessage];
        if (!recurrence) return nil;
    }

    id rawCompletedDates = task[@"completedDates"];
    NSArray *completedDates = @[];
    if (rawCompletedDates && rawCompletedDates != [NSNull null]) {
        completedDates = [self normalizedCompletedDates:rawCompletedDates errorMessage:errorMessage];
        if (!completedDates) return nil;
    }
    // Per-date state only applies to recurring templates. One-off tasks keep
    // their single completion state in done.
    if (!recurrence) completedDates = @[];

    NSMutableDictionary *normalized = [task mutableCopy];
    normalized[@"done"] = recurrence ? @NO : (task[@"done"] ? ([task[@"done"] boolValue] ? @YES : @NO) : @NO);
    normalized[@"recurrence"] = recurrence ?: [NSNull null];
    normalized[@"completedDates"] = completedDates;
    return normalized;
}

- (NSDictionary *)normalizedRecurrence:(id)value errorMessage:(NSString **)errorMessage {
    if (![value isKindOfClass:[NSDictionary class]]) {
        if (errorMessage) *errorMessage = @"Task recurrence must be an object or null.";
        return nil;
    }

    NSDictionary *raw = (NSDictionary *)value;
    NSString *type = raw[@"type"];
    NSArray *rawWeekdays = raw[@"weekdays"];
    NSString *start = raw[@"start"];
    id rawEnd = raw[@"end"];
    if (![type isKindOfClass:[NSString class]] ||
        (![type isEqualToString:@"daily"] && ![type isEqualToString:@"weekly"]) ||
        ![rawWeekdays isKindOfClass:[NSArray class]] ||
        ![self isValidISODateString:start]) {
        if (errorMessage) *errorMessage = @"Recurrence requires type, weekdays, and a YYYY-MM-DD start date.";
        return nil;
    }

    NSMutableArray *weekdays = [NSMutableArray array];
    for (id weekday in rawWeekdays) {
        if (![weekday isKindOfClass:[NSNumber class]] ||
            [weekday doubleValue] != (double)[weekday integerValue] ||
            [weekday integerValue] < 0 || [weekday integerValue] > 6 ||
            [weekdays containsObject:weekday]) {
            if (errorMessage) *errorMessage = @"Recurrence weekdays must contain unique integers from 0 through 6.";
            return nil;
        }
        [weekdays addObject:@([weekday integerValue])];
    }

    NSString *end = nil;
    if (rawEnd && rawEnd != [NSNull null]) {
        if (![rawEnd isKindOfClass:[NSString class]] || ![self isValidISODateString:rawEnd]) {
            if (errorMessage) *errorMessage = @"Recurrence end must be a YYYY-MM-DD date or null.";
            return nil;
        }
        end = rawEnd;
        if ([end compare:start] == NSOrderedAscending) {
            if (errorMessage) *errorMessage = @"Recurrence end cannot be before its start date.";
            return nil;
        }
    }

    return @{
        @"type": type,
        @"weekdays": weekdays,
        @"start": start,
        @"end": end ?: [NSNull null],
    };
}

- (NSArray *)normalizedCompletedDates:(id)value errorMessage:(NSString **)errorMessage {
    if (![value isKindOfClass:[NSArray class]]) {
        if (errorMessage) *errorMessage = @"Task completedDates must be an array or null.";
        return nil;
    }

    NSMutableArray *dates = [NSMutableArray array];
    for (id date in (NSArray *)value) {
        if (![self isValidISODateString:date]) {
            if (errorMessage) *errorMessage = @"Task completedDates must contain YYYY-MM-DD strings.";
            return nil;
        }
        if (![dates containsObject:date]) [dates addObject:date];
    }
    return dates;
}

- (BOOL)isValidISODateString:(id)value {
    if (![value isKindOfClass:[NSString class]] || [(NSString *)value length] != 10) return NO;
    NSString *date = (NSString *)value;
    if ([date characterAtIndex:4] != '-' || [date characterAtIndex:7] != '-') return NO;
    for (NSUInteger index = 0; index < date.length; index++) {
        if (index == 4 || index == 7) continue;
        unichar character = [date characterAtIndex:index];
        if (character < '0' || character > '9') return NO;
    }
    return YES;
}

- (NSDictionary *)recurrenceFromJSON:(NSString *)json {
    if (json.length == 0) return nil;
    NSData *data = [json dataUsingEncoding:NSUTF8StringEncoding];
    id parsed = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
    return [parsed isKindOfClass:[NSDictionary class]]
        ? [self normalizedRecurrence:parsed errorMessage:nil]
        : nil;
}

- (NSArray *)completedDatesFromJSON:(NSString *)json {
    if (json.length == 0) return @[];
    NSData *data = [json dataUsingEncoding:NSUTF8StringEncoding];
    id parsed = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
    NSArray *dates = [parsed isKindOfClass:[NSArray class]]
        ? [self normalizedCompletedDates:parsed errorMessage:nil]
        : nil;
    return dates ?: @[];
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
    NSDictionary *recurrence = [task[@"recurrence"] isKindOfClass:[NSDictionary class]] ? task[@"recurrence"] : nil;
    NSArray *completedDates = [task[@"completedDates"] isKindOfClass:[NSArray class]] ? task[@"completedDates"] : @[];
    NSError *serializationError = nil;
    NSData *recurrenceData = recurrence
        ? [NSJSONSerialization dataWithJSONObject:recurrence options:0 error:&serializationError]
        : nil;
    if (recurrence && !recurrenceData) {
        sqlite3_finalize(statement);
        return NO;
    }
    NSData *completedDatesData = [NSJSONSerialization dataWithJSONObject:completedDates options:0 error:&serializationError];
    if (!completedDatesData) {
        sqlite3_finalize(statement);
        return NO;
    }
    NSString *recurrenceJSON = recurrenceData ? [[NSString alloc] initWithData:recurrenceData encoding:NSUTF8StringEncoding] : nil;
    NSString *completedDatesJSON = [[NSString alloc] initWithData:completedDatesData encoding:NSUTF8StringEncoding];
    NSString *timestamp = [self timestamp];

    BOOL bound = sqlite3_bind_int64(statement, 1, taskId.longLongValue) == SQLITE_OK &&
        sqlite3_bind_text(statement, 2, title.UTF8String, -1, SQLITE_TRANSIENT) == SQLITE_OK &&
        sqlite3_bind_int(statement, 3, [task[@"done"] boolValue] ? 1 : 0) == SQLITE_OK &&
        sqlite3_bind_text(statement, 4, tag.UTF8String, -1, SQLITE_TRANSIENT) == SQLITE_OK &&
        sqlite3_bind_text(statement, 5, date.UTF8String, -1, SQLITE_TRANSIENT) == SQLITE_OK;
    if (bound) {
        bound = time.length > 0
            ? sqlite3_bind_text(statement, 6, time.UTF8String, -1, SQLITE_TRANSIENT) == SQLITE_OK
            : sqlite3_bind_null(statement, 6) == SQLITE_OK;
    }
    if (bound) {
        bound = priority.length > 0
            ? sqlite3_bind_text(statement, 7, priority.UTF8String, -1, SQLITE_TRANSIENT) == SQLITE_OK
            : sqlite3_bind_null(statement, 7) == SQLITE_OK;
    }
    if (bound) {
        bound = recurrenceJSON
            ? sqlite3_bind_text(statement, 8, recurrenceJSON.UTF8String, -1, SQLITE_TRANSIENT) == SQLITE_OK
            : sqlite3_bind_null(statement, 8) == SQLITE_OK;
    }
    if (bound) bound = sqlite3_bind_text(statement, 9, completedDatesJSON.UTF8String, -1, SQLITE_TRANSIENT) == SQLITE_OK;
    if (bound) bound = sqlite3_bind_text(statement, 10, timestamp.UTF8String, -1, SQLITE_TRANSIENT) == SQLITE_OK;
    if (bound) bound = sqlite3_bind_text(statement, 11, timestamp.UTF8String, -1, SQLITE_TRANSIENT) == SQLITE_OK;
    if (!bound) {
        sqlite3_finalize(statement);
        return NO;
    }

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
