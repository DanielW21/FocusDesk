#import "FDTaskManagerDatabase.h"

#import <sqlite3.h>

static NSInteger const FDTaskManagerSchemaVersion = 1;
static NSString *const FDTaskManagerAPI = @"v1";

@interface FDTaskManagerDatabase ()
@property (assign) sqlite3 *database;
@property (copy) NSString *databasePath;
@property (copy) NSString *initializationError;
@property (strong) dispatch_queue_t executionQueue;
@end

@implementation FDTaskManagerDatabase

- (instancetype)init {
    self = [super init];
    if (self) {
        _executionQueue = dispatch_queue_create("com.danielwu.focusdesk.taskmanager-database", DISPATCH_QUEUE_SERIAL);
        dispatch_sync(_executionQueue, ^{
            [self openDatabase];
        });
    }
    return self;
}

- (void)invokeOperation:(NSString *)operation
                payload:(NSDictionary *)payload
             completion:(FDTaskManagerDatabaseCompletion)completion {
    dispatch_async(self.executionQueue, ^{
        NSDictionary *response;
        if (self.initializationError.length > 0) {
            response = [self errorWithCode:@"FOCUSDESK_DATABASE_UNAVAILABLE" message:self.initializationError];
        } else if ([operation isEqualToString:@"system.health"]) {
            response = [self health];
        } else if ([operation isEqualToString:@"courses.list"]) {
            response = [self listCourses];
        } else if ([operation isEqualToString:@"courses.create"]) {
            response = [self createCourse:payload];
        } else if ([operation isEqualToString:@"courses.update"]) {
            response = [self updateCourse:payload];
        } else if ([operation isEqualToString:@"courses.delete"]) {
            response = [self deleteCourse:payload];
        } else if ([operation isEqualToString:@"tasks.list"]) {
            response = [self listManagedTasks:payload];
        } else if ([operation isEqualToString:@"tasks.get"]) {
            response = [self getManagedTask:payload];
        } else if ([operation isEqualToString:@"tasks.create"]) {
            response = [self createManagedTask:payload];
        } else if ([operation isEqualToString:@"tasks.update"]) {
            response = [self updateManagedTask:payload];
        } else if ([operation isEqualToString:@"tasks.complete"]) {
            response = [self setManagedTaskCompletion:payload completed:YES];
        } else if ([operation isEqualToString:@"tasks.reopen"]) {
            response = [self setManagedTaskCompletion:payload completed:NO];
        } else if ([operation isEqualToString:@"tasks.delete"]) {
            response = [self deleteManagedTask:payload];
        } else if ([operation isEqualToString:@"tasks.upcoming"]) {
            response = [self listManagedTasks:@{ @"includeCompleted": @NO }];
        } else if ([operation isEqualToString:@"tasks.progress"]) {
            response = [self progress];
        } else if ([operation isEqualToString:@"data.export"]) {
            response = [self exportData];
        } else {
            response = [self errorWithCode:@"UNKNOWN_OPERATION"
                                   message:[NSString stringWithFormat:@"Unsupported FocusDesk task operation: %@", operation]];
        }
        dispatch_async(dispatch_get_main_queue(), ^{
            completion(response);
        });
    });
}

- (void)openDatabase {
    NSFileManager *fileManager = [NSFileManager defaultManager];
    NSError *error = nil;
    NSURL *applicationSupport = [fileManager URLForDirectory:NSApplicationSupportDirectory
                                                     inDomain:NSUserDomainMask
                                            appropriateForURL:nil
                                                       create:YES
                                                        error:&error];
    if (!applicationSupport) {
        self.initializationError = error.localizedDescription ?: @"FocusDesk could not locate Application Support.";
        return;
    }
    NSURL *directory = [applicationSupport URLByAppendingPathComponent:@"FocusDesk" isDirectory:YES];
    if (![fileManager createDirectoryAtURL:directory withIntermediateDirectories:YES attributes:nil error:&error]) {
        self.initializationError = error.localizedDescription ?: @"FocusDesk could not create its data directory.";
        return;
    }
    NSURL *databaseURL = [directory URLByAppendingPathComponent:@"focusdesk.sqlite3"];
    self.databasePath = databaseURL.path;
    if (sqlite3_open_v2(databaseURL.fileSystemRepresentation, &_database,
                         SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX, NULL) != SQLITE_OK) {
        self.initializationError = [self sqliteMessage];
        return;
    }
    sqlite3_busy_timeout(self.database, 5000);
    const char *schema =
        "PRAGMA journal_mode = WAL;"
        "PRAGMA foreign_keys = ON;"
        "CREATE TABLE IF NOT EXISTS metadata ("
            "key TEXT PRIMARY KEY NOT NULL,"
            "value TEXT NOT NULL"
        ");"
        "CREATE TABLE IF NOT EXISTS courses ("
            "id TEXT PRIMARY KEY NOT NULL,"
            "name TEXT NOT NULL UNIQUE,"
            "created_at TEXT NOT NULL,"
            "updated_at TEXT NOT NULL"
        ");"
        "CREATE TABLE IF NOT EXISTS task_manager_tasks ("
            "id TEXT PRIMARY KEY NOT NULL,"
            "course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,"
            "title TEXT NOT NULL,"
            "weight REAL NOT NULL DEFAULT 0,"
            "deadline TEXT,"
            "completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0, 1)),"
            "is_exam INTEGER NOT NULL DEFAULT 0 CHECK(is_exam IN (0, 1)),"
            "recurrence_type TEXT,"
            "recurrence_weekday INTEGER,"
            "recurrence_start TEXT,"
            "recurrence_end TEXT,"
            "completed_occurrences TEXT NOT NULL DEFAULT '[]',"
            "priority TEXT NOT NULL DEFAULT 'normal',"
            "status TEXT NOT NULL DEFAULT 'none',"
            "created_at TEXT NOT NULL,"
            "updated_at TEXT NOT NULL"
        ");"
        "CREATE INDEX IF NOT EXISTS task_manager_course_index ON task_manager_tasks(course_id);"
        "CREATE INDEX IF NOT EXISTS task_manager_deadline_index ON task_manager_tasks(deadline);"
        "INSERT OR IGNORE INTO metadata(key, value) VALUES ('taskmanager_schema_version', '1');"
        "INSERT OR IGNORE INTO metadata(key, value) VALUES ('taskmanager_revision', '0');";
    char *errorMessage = NULL;
    if (sqlite3_exec(self.database, schema, NULL, NULL, &errorMessage) != SQLITE_OK) {
        self.initializationError = errorMessage ? [NSString stringWithUTF8String:errorMessage] : [self sqliteMessage];
        sqlite3_free(errorMessage);
        return;
    }
    [self migrateLegacyJSONIfNeeded];
}

- (void)migrateLegacyJSONIfNeeded {
    if ([self countForSQL:@"SELECT COUNT(*) FROM courses"] > 0 || [self metadataValue:@"taskmanager_legacy_migrated"].length > 0) return;

    NSMutableArray<NSString *> *candidates = [NSMutableArray array];
    NSString *environmentPath = NSProcessInfo.processInfo.environment[@"FOCUSDESK_LEGACY_TASKS_FILE"];
    if (environmentPath.length > 0) [candidates addObject:[environmentPath stringByExpandingTildeInPath]];
    NSString *savedPath = [[NSUserDefaults standardUserDefaults] stringForKey:@"FocusDeskTaskManagerDataFile"];
    if (savedPath.length > 0) [candidates addObject:[savedPath stringByExpandingTildeInPath]];
    NSString *applicationSupport = [NSSearchPathForDirectoriesInDomains(NSApplicationSupportDirectory, NSUserDomainMask, YES).firstObject stringByAppendingPathComponent:@"FocusDesk/tasks/tasks.json"];
    [candidates addObject:applicationSupport];

    for (NSString *path in candidates) {
        if ([[NSFileManager defaultManager] fileExistsAtPath:path] && [self importLegacyJSONAtPath:path]) {
            [self setMetadataValue:path forKey:@"taskmanager_legacy_migrated"];
            break;
        }
    }
}

- (BOOL)importLegacyJSONAtPath:(NSString *)path {
    NSData *data = [NSData dataWithContentsOfFile:path];
    NSDictionary *document = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
    NSDictionary *courses = [document isKindOfClass:[NSDictionary class]] ? document[@"courses"] : nil;
    if (![courses isKindOfClass:[NSDictionary class]]) return NO;

    for (NSString *courseName in courses) {
        NSDictionary *legacyCourse = [courses[courseName] isKindOfClass:[NSDictionary class]] ? courses[courseName] : nil;
        if (!legacyCourse) continue;
        NSString *courseId = [self stringValue:legacyCourse[@"id"]] ?: [NSUUID UUID].UUIDString;
        NSString *createdAt = [self stringValue:legacyCourse[@"createdAt"]] ?: [self timestamp];
        NSString *updatedAt = [self stringValue:legacyCourse[@"updatedAt"]] ?: createdAt;
        sqlite3_stmt *courseStatement = NULL;
        if (sqlite3_prepare_v2(self.database, "INSERT OR IGNORE INTO courses(id, name, created_at, updated_at) VALUES (?, ?, ?, ?)", -1, &courseStatement, NULL) != SQLITE_OK) return NO;
        sqlite3_bind_text(courseStatement, 1, courseId.UTF8String, -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(courseStatement, 2, courseName.UTF8String, -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(courseStatement, 3, createdAt.UTF8String, -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(courseStatement, 4, updatedAt.UTF8String, -1, SQLITE_TRANSIENT);
        BOOL courseInserted = sqlite3_step(courseStatement) == SQLITE_DONE;
        sqlite3_finalize(courseStatement);
        if (!courseInserted) return NO;

        NSArray *legacyTasks = [legacyCourse[@"tasks"] isKindOfClass:[NSArray class]] ? legacyCourse[@"tasks"] : @[];
        for (NSDictionary *legacyTask in legacyTasks) {
            if (![legacyTask isKindOfClass:[NSDictionary class]]) continue;
            NSString *taskId = [self stringValue:legacyTask[@"id"]] ?: [NSUUID UUID].UUIDString;
            NSString *title = [self stringValue:legacyTask[@"name"]] ?: [self stringValue:legacyTask[@"title"]];
            if (title.length == 0) continue;
            NSMutableDictionary *task = [@{
                @"id": taskId,
                @"courseId": courseId,
                @"title": title,
                @"weight": legacyTask[@"weight"] ?: @0,
                @"deadline": legacyTask[@"deadline"] ?: [NSNull null],
                @"completed": legacyTask[@"completed"] ?: @NO,
                @"isExam": legacyTask[@"is_exam"] ?: legacyTask[@"isExam"] ?: @NO,
                @"priority": [self validPriority:legacyTask[@"priority"]] ?: @"normal",
                @"status": [self validStatus:legacyTask[@"status"]] ?: @"none",
                @"completedOccurrences": legacyTask[@"completed_occurrences"] ?: @[],
                @"createdAt": [self stringValue:legacyTask[@"createdAt"]] ?: createdAt,
                @"updatedAt": [self stringValue:legacyTask[@"updatedAt"]] ?: updatedAt,
            } mutableCopy];
            NSString *recurrenceType = [self stringValue:legacyTask[@"recurrence"]];
            if (recurrenceType.length > 0) {
                task[@"recurrence"] = @{
                    @"type": recurrenceType,
                    @"weekday": legacyTask[@"recurrence_weekday"] ?: [NSNull null],
                    @"start": legacyTask[@"recurrence_start"] ?: [NSNull null],
                    @"end": legacyTask[@"recurrence_end"] ?: [NSNull null],
                };
            } else {
                task[@"recurrence"] = [NSNull null];
            }
            if (![self upsertManagedTask:task]) return NO;
        }
    }
    return YES;
}

- (NSDictionary *)health {
    NSInteger courseCount = [self countForSQL:@"SELECT COUNT(*) FROM courses"];
    NSInteger taskCount = [self countForSQL:@"SELECT COUNT(*) FROM task_manager_tasks"];
    NSInteger revision = [self revision];
    return [self success:@{
        @"status": @"ok",
        @"apiVersion": FDTaskManagerAPI,
        @"toolVersion": @"FocusDesk",
        @"schemaVersion": @(FDTaskManagerSchemaVersion),
        @"supportedSchemaVersion": @(FDTaskManagerSchemaVersion),
        @"revision": @(revision),
        @"dataFile": self.databasePath ?: @"",
        @"courseCount": @(courseCount),
        @"taskCount": @(taskCount),
        @"issues": @[],
        @"storageMode": @"sqlite",
    }];
}

- (NSDictionary *)listCourses {
    sqlite3_stmt *statement = NULL;
    if (sqlite3_prepare_v2(self.database, "SELECT id, name, created_at, updated_at FROM courses ORDER BY name COLLATE NOCASE", -1, &statement, NULL) != SQLITE_OK)
        return [self sqliteError:@"FOCUSDESK_DATABASE_READ_FAILED"];
    NSMutableArray *courses = [NSMutableArray array];
    while (sqlite3_step(statement) == SQLITE_ROW) {
        NSString *courseId = [self stringColumn:statement index:0] ?: @"";
        NSInteger total = [self countForSQL:@"SELECT COUNT(*) FROM task_manager_tasks WHERE course_id = ?" binding:courseId];
        NSInteger completed = [self countForSQL:@"SELECT COUNT(*) FROM task_manager_tasks WHERE course_id = ? AND completed = 1" binding:courseId];
        [courses addObject:@{
            @"id": courseId,
            @"name": [self stringColumn:statement index:1] ?: @"",
            @"taskCount": @(total),
            @"completedTaskCount": @(completed),
            @"progressPercentage": @(total ? ((double)completed / (double)total) * 100.0 : 0.0),
            @"createdAt": [self stringColumn:statement index:2] ?: @"",
            @"updatedAt": [self stringColumn:statement index:3] ?: @"",
        }];
    }
    sqlite3_finalize(statement);
    return [self success:@{ @"courses": courses }];
}

- (NSDictionary *)createCourse:(NSDictionary *)payload {
    NSString *name = [payload[@"name"] isKindOfClass:[NSString class]] ? [payload[@"name"] stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet] : @"";
    if (name.length == 0) return [self errorWithCode:@"INVALID_REQUEST" message:@"Course name is required."];
    if ([self courseByName:name]) return [self errorWithCode:@"COURSE_ALREADY_EXISTS" message:@"A course with that name already exists."];
    NSString *courseId = [NSUUID UUID].UUIDString;
    NSString *timestamp = [self timestamp];
    sqlite3_stmt *statement = NULL;
    if (sqlite3_prepare_v2(self.database, "INSERT INTO courses(id, name, created_at, updated_at) VALUES (?, ?, ?, ?)", -1, &statement, NULL) != SQLITE_OK)
        return [self sqliteError:@"FOCUSDESK_DATABASE_WRITE_FAILED"];
    sqlite3_bind_text(statement, 1, courseId.UTF8String, -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(statement, 2, name.UTF8String, -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(statement, 3, timestamp.UTF8String, -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(statement, 4, timestamp.UTF8String, -1, SQLITE_TRANSIENT);
    int result = sqlite3_step(statement);
    sqlite3_finalize(statement);
    if (result != SQLITE_DONE) return [self sqliteError:@"FOCUSDESK_DATABASE_WRITE_FAILED"];
    NSInteger revision = [self bumpRevision];
    return [self success:@{ @"course": [self courseById:courseId], @"revision": @(revision) }];
}

- (NSDictionary *)updateCourse:(NSDictionary *)payload {
    NSString *courseId = [self stringValue:payload[@"id"]];
    NSString *name = [self stringValue:payload[@"name"]];
    if (courseId.length == 0 || name.length == 0) return [self errorWithCode:@"INVALID_REQUEST" message:@"Course id and name are required."];
    NSDictionary *course = [self courseById:courseId];
    if (!course) return [self errorWithCode:@"COURSE_NOT_FOUND" message:@"Course does not exist."];
    NSDictionary *sameName = [self courseByName:name];
    if (sameName && ![sameName[@"id"] isEqual:courseId]) return [self errorWithCode:@"COURSE_ALREADY_EXISTS" message:@"A course with that name already exists."];
    sqlite3_stmt *statement = NULL;
    if (sqlite3_prepare_v2(self.database, "UPDATE courses SET name = ?, updated_at = ? WHERE id = ?", -1, &statement, NULL) != SQLITE_OK)
        return [self sqliteError:@"FOCUSDESK_DATABASE_WRITE_FAILED"];
    NSString *timestamp = [self timestamp];
    sqlite3_bind_text(statement, 1, name.UTF8String, -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(statement, 2, timestamp.UTF8String, -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(statement, 3, courseId.UTF8String, -1, SQLITE_TRANSIENT);
    int result = sqlite3_step(statement);
    sqlite3_finalize(statement);
    if (result != SQLITE_DONE) return [self sqliteError:@"FOCUSDESK_DATABASE_WRITE_FAILED"];
    NSInteger revision = [self bumpRevision];
    return [self success:@{ @"course": [self courseById:courseId], @"revision": @(revision) }];
}

- (NSDictionary *)deleteCourse:(NSDictionary *)payload {
    NSString *courseId = [self stringValue:payload[@"id"]];
    if (![payload[@"confirm"] boolValue]) return [self errorWithCode:@"CONFIRMATION_REQUIRED" message:@"Deleting a course requires confirmation."];
    if (![self courseById:courseId]) return [self errorWithCode:@"COURSE_NOT_FOUND" message:@"Course does not exist."];
    sqlite3_stmt *statement = NULL;
    if (sqlite3_prepare_v2(self.database, "DELETE FROM courses WHERE id = ?", -1, &statement, NULL) != SQLITE_OK)
        return [self sqliteError:@"FOCUSDESK_DATABASE_WRITE_FAILED"];
    sqlite3_bind_text(statement, 1, courseId.UTF8String, -1, SQLITE_TRANSIENT);
    int result = sqlite3_step(statement);
    sqlite3_finalize(statement);
    if (result != SQLITE_DONE) return [self sqliteError:@"FOCUSDESK_DATABASE_WRITE_FAILED"];
    NSInteger revision = [self bumpRevision];
    return [self success:@{ @"deletedId": courseId, @"revision": @(revision) }];
}

- (NSDictionary *)listManagedTasks:(NSDictionary *)payload {
    BOOL includeCompleted = payload[@"includeCompleted"] == nil || [payload[@"includeCompleted"] boolValue];
    NSString *courseId = [self stringValue:payload[@"courseId"]];
    NSNumber *isExam = [payload[@"isExam"] isKindOfClass:[NSNumber class]] ? payload[@"isExam"] : nil;
    sqlite3_stmt *statement = NULL;
    const char *sql = "SELECT t.id, t.course_id, c.name, t.title, t.weight, t.deadline, t.completed, t.is_exam, t.priority, t.status, t.recurrence_type, t.recurrence_weekday, t.recurrence_start, t.recurrence_end, t.completed_occurrences, t.created_at, t.updated_at FROM task_manager_tasks t JOIN courses c ON c.id = t.course_id ORDER BY t.deadline IS NULL, t.deadline, t.title COLLATE NOCASE";
    if (sqlite3_prepare_v2(self.database, sql, -1, &statement, NULL) != SQLITE_OK) return [self sqliteError:@"FOCUSDESK_DATABASE_READ_FAILED"];
    NSMutableArray *tasks = [NSMutableArray array];
    while (sqlite3_step(statement) == SQLITE_ROW) {
        BOOL completed = sqlite3_column_int(statement, 6) != 0;
        BOOL exam = sqlite3_column_int(statement, 7) != 0;
        NSString *rowCourseId = [self stringColumn:statement index:1] ?: @"";
        if (courseId.length > 0 && ![courseId isEqual:rowCourseId]) continue;
        if (!includeCompleted && completed) continue;
        if (isExam && exam != isExam.boolValue) continue;
        [tasks addObject:[self managedTaskRecordFromStatement:statement]];
    }
    sqlite3_finalize(statement);
    return [self success:@{ @"tasks": tasks }];
}

- (NSDictionary *)getManagedTask:(NSDictionary *)payload {
    NSDictionary *task = [self managedTaskById:[self stringValue:payload[@"id"]]];
    return task ? [self success:@{ @"task": task }] : [self errorWithCode:@"TASK_NOT_FOUND" message:@"Task does not exist."];
}

- (NSDictionary *)createManagedTask:(NSDictionary *)payload {
    NSString *courseId = [self stringValue:payload[@"courseId"]];
    if (![self courseById:courseId]) return [self errorWithCode:@"COURSE_NOT_FOUND" message:@"Course does not exist."];
    NSString *title = [self stringValue:payload[@"title"]];
    if (title.length == 0) return [self errorWithCode:@"INVALID_REQUEST" message:@"Task title is required."];
    NSString *now = [self timestamp];
    NSMutableDictionary *task = [@{
        @"id": [NSUUID UUID].UUIDString,
        @"courseId": courseId,
        @"title": title,
        @"weight": @([payload[@"weight"] doubleValue]),
        @"deadline": payload[@"deadline"] ?: [NSNull null],
        @"completed": payload[@"completed"] ?: @NO,
        @"isExam": payload[@"isExam"] ?: @NO,
        @"priority": [self validPriority:payload[@"priority"]] ?: @"normal",
        @"status": [self validStatus:payload[@"status"]] ?: @"none",
        @"recurrence": payload[@"recurrence"] ?: [NSNull null],
        @"completedOccurrences": @[],
        @"createdAt": now,
        @"updatedAt": now,
    } mutableCopy];
    if (![self upsertManagedTask:task]) return [self sqliteError:@"FOCUSDESK_DATABASE_WRITE_FAILED"];
    NSInteger revision = [self bumpRevision];
    return [self success:@{ @"task": [self managedTaskById:task[@"id"]], @"revision": @(revision) }];
}

- (NSDictionary *)updateManagedTask:(NSDictionary *)payload {
    NSString *taskId = [self stringValue:payload[@"id"]];
    NSMutableDictionary *task = [[self managedTaskById:taskId] mutableCopy];
    if (!task) return [self errorWithCode:@"TASK_NOT_FOUND" message:@"Task does not exist."];
    for (NSString *key in @[@"courseId", @"title", @"weight", @"deadline", @"completed", @"isExam", @"priority", @"status", @"recurrence"]) {
        if (payload[key] != nil) task[key] = payload[key];
    }
    if (![self courseById:[self stringValue:task[@"courseId"]]]) return [self errorWithCode:@"COURSE_NOT_FOUND" message:@"Course does not exist."];
    task[@"updatedAt"] = [self timestamp];
    if (![self upsertManagedTask:task]) return [self sqliteError:@"FOCUSDESK_DATABASE_WRITE_FAILED"];
    NSInteger revision = [self bumpRevision];
    return [self success:@{ @"task": [self managedTaskById:taskId], @"revision": @(revision) }];
}

- (NSDictionary *)setManagedTaskCompletion:(NSDictionary *)payload completed:(BOOL)completed {
    NSString *taskId = [self stringValue:payload[@"id"]];
    NSMutableDictionary *task = [[self managedTaskById:taskId] mutableCopy];
    if (!task) return [self errorWithCode:@"TASK_NOT_FOUND" message:@"Task does not exist."];
    NSString *occurrence = [self stringValue:payload[@"occurrenceDate"]];
    if (occurrence.length > 0) {
        NSDictionary *recurrence = [task[@"recurrence"] isKindOfClass:[NSDictionary class]] ? task[@"recurrence"] : nil;
        if (!recurrence) return [self errorWithCode:@"INVALID_REQUEST" message:@"occurrenceDate requires a recurring task."];
        NSMutableArray *occurrences = [task[@"completedOccurrences"] mutableCopy] ?: [NSMutableArray array];
        if (completed && ![occurrences containsObject:occurrence]) [occurrences addObject:occurrence];
        if (!completed) [occurrences removeObject:occurrence];
        task[@"completedOccurrences"] = occurrences;
    } else {
        task[@"completed"] = @(completed);
    }
    task[@"updatedAt"] = [self timestamp];
    if (![self upsertManagedTask:task]) return [self sqliteError:@"FOCUSDESK_DATABASE_WRITE_FAILED"];
    NSMutableDictionary *result = [[self managedTaskById:taskId] mutableCopy];
    if (occurrence.length > 0) {
        result[@"id"] = [NSString stringWithFormat:@"%@:%@", taskId, occurrence];
        result[@"occurrenceDate"] = occurrence;
        result[@"completed"] = @([task[@"completedOccurrences"] containsObject:occurrence]);
        result[@"deadline"] = [NSString stringWithFormat:@"%@T23:59:00-04:00", occurrence];
    }
    NSInteger revision = [self bumpRevision];
    return [self success:@{ @"task": result, @"revision": @(revision) }];
}

- (NSDictionary *)deleteManagedTask:(NSDictionary *)payload {
    NSString *taskId = [self stringValue:payload[@"id"]];
    if (![payload[@"confirm"] boolValue]) return [self errorWithCode:@"CONFIRMATION_REQUIRED" message:@"Deleting a task requires confirmation."];
    if (![self managedTaskById:taskId]) return [self errorWithCode:@"TASK_NOT_FOUND" message:@"Task does not exist."];
    sqlite3_stmt *statement = NULL;
    if (sqlite3_prepare_v2(self.database, "DELETE FROM task_manager_tasks WHERE id = ?", -1, &statement, NULL) != SQLITE_OK) return [self sqliteError:@"FOCUSDESK_DATABASE_WRITE_FAILED"];
    sqlite3_bind_text(statement, 1, taskId.UTF8String, -1, SQLITE_TRANSIENT);
    int result = sqlite3_step(statement);
    sqlite3_finalize(statement);
    if (result != SQLITE_DONE) return [self sqliteError:@"FOCUSDESK_DATABASE_WRITE_FAILED"];
    NSInteger revision = [self bumpRevision];
    return [self success:@{ @"deletedId": taskId, @"revision": @(revision) }];
}

- (NSDictionary *)progress {
    NSDictionary *courses = [self listCourses];
    NSArray *items = courses[@"data"][@"courses"];
    NSInteger total = 0;
    NSInteger completed = 0;
    for (NSDictionary *course in items) {
        total += [course[@"taskCount"] integerValue];
        completed += [course[@"completedTaskCount"] integerValue];
    }
    return [self success:@{ @"courses": items, @"overall": @{ @"taskCount": @(total), @"completedTaskCount": @(completed), @"progressPercentage": @(total ? ((double)completed / total) * 100.0 : 0.0) } }];
}

- (NSDictionary *)exportData {
    NSDictionary *coursesResponse = [self listCourses];
    NSDictionary *tasksResponse = [self listManagedTasks:@{ @"includeCompleted": @YES }];
    return [self success:@{ @"schemaVersion": @(FDTaskManagerSchemaVersion), @"courses": coursesResponse[@"data"][@"courses"], @"tasks": tasksResponse[@"data"][@"tasks"] }];
}

- (BOOL)upsertManagedTask:(NSDictionary *)task {
    NSDictionary *recurrence = [task[@"recurrence"] isKindOfClass:[NSDictionary class]] ? task[@"recurrence"] : nil;
    NSArray *occurrences = [task[@"completedOccurrences"] isKindOfClass:[NSArray class]] ? task[@"completedOccurrences"] : @[];
    NSData *occurrenceData = [NSJSONSerialization dataWithJSONObject:occurrences options:0 error:nil];
    NSString *occurrenceJSON = [[NSString alloc] initWithData:occurrenceData encoding:NSUTF8StringEncoding] ?: @"[]";
    const char *sql = "INSERT INTO task_manager_tasks(id, course_id, title, weight, deadline, completed, is_exam, recurrence_type, recurrence_weekday, recurrence_start, recurrence_end, completed_occurrences, priority, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET course_id=excluded.course_id, title=excluded.title, weight=excluded.weight, deadline=excluded.deadline, completed=excluded.completed, is_exam=excluded.is_exam, recurrence_type=excluded.recurrence_type, recurrence_weekday=excluded.recurrence_weekday, recurrence_start=excluded.recurrence_start, recurrence_end=excluded.recurrence_end, completed_occurrences=excluded.completed_occurrences, priority=excluded.priority, status=excluded.status, updated_at=excluded.updated_at";
    sqlite3_stmt *statement = NULL;
    if (sqlite3_prepare_v2(self.database, sql, -1, &statement, NULL) != SQLITE_OK) return NO;
    NSString *id = [self stringValue:task[@"id"]];
    NSString *courseId = [self stringValue:task[@"courseId"]];
    NSString *title = [self stringValue:task[@"title"]];
    NSString *deadline = [self stringValue:task[@"deadline"]];
    NSString *createdAt = [self stringValue:task[@"createdAt"]] ?: [self timestamp];
    NSString *updatedAt = [self stringValue:task[@"updatedAt"]] ?: [self timestamp];
    sqlite3_bind_text(statement, 1, id.UTF8String, -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(statement, 2, courseId.UTF8String, -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(statement, 3, title.UTF8String, -1, SQLITE_TRANSIENT);
    sqlite3_bind_double(statement, 4, [task[@"weight"] doubleValue]);
    if (deadline.length > 0) sqlite3_bind_text(statement, 5, deadline.UTF8String, -1, SQLITE_TRANSIENT); else sqlite3_bind_null(statement, 5);
    sqlite3_bind_int(statement, 6, [task[@"completed"] boolValue]);
    sqlite3_bind_int(statement, 7, [task[@"isExam"] boolValue]);
    NSString *recurrenceType = [self stringValue:recurrence[@"type"]];
    if (recurrenceType.length > 0) sqlite3_bind_text(statement, 8, recurrenceType.UTF8String, -1, SQLITE_TRANSIENT); else sqlite3_bind_null(statement, 8);
    if ([recurrence[@"weekday"] isKindOfClass:[NSNumber class]]) sqlite3_bind_int(statement, 9, [recurrence[@"weekday"] intValue]); else sqlite3_bind_null(statement, 9);
    NSString *start = [self stringValue:recurrence[@"start"]];
    NSString *end = [self stringValue:recurrence[@"end"]];
    if (start.length > 0) sqlite3_bind_text(statement, 10, start.UTF8String, -1, SQLITE_TRANSIENT); else sqlite3_bind_null(statement, 10);
    if (end.length > 0) sqlite3_bind_text(statement, 11, end.UTF8String, -1, SQLITE_TRANSIENT); else sqlite3_bind_null(statement, 11);
    sqlite3_bind_text(statement, 12, occurrenceJSON.UTF8String, -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(statement, 13, ([self validPriority:task[@"priority"]] ?: @"normal").UTF8String, -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(statement, 14, ([self validStatus:task[@"status"]] ?: @"none").UTF8String, -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(statement, 15, createdAt.UTF8String, -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(statement, 16, updatedAt.UTF8String, -1, SQLITE_TRANSIENT);
    int result = sqlite3_step(statement);
    sqlite3_finalize(statement);
    return result == SQLITE_DONE;
}

- (NSDictionary *)managedTaskById:(NSString *)taskId {
    if (taskId.length == 0) return nil;
    const char *sql = "SELECT t.id, t.course_id, c.name, t.title, t.weight, t.deadline, t.completed, t.is_exam, t.priority, t.status, t.recurrence_type, t.recurrence_weekday, t.recurrence_start, t.recurrence_end, t.completed_occurrences, t.created_at, t.updated_at FROM task_manager_tasks t JOIN courses c ON c.id = t.course_id WHERE t.id = ?";
    sqlite3_stmt *statement = NULL;
    if (sqlite3_prepare_v2(self.database, sql, -1, &statement, NULL) != SQLITE_OK) return nil;
    sqlite3_bind_text(statement, 1, taskId.UTF8String, -1, SQLITE_TRANSIENT);
    NSDictionary *task = sqlite3_step(statement) == SQLITE_ROW ? [self managedTaskRecordFromStatement:statement] : nil;
    sqlite3_finalize(statement);
    return task;
}

- (NSDictionary *)managedTaskRecordFromStatement:(sqlite3_stmt *)statement {
    NSString *recurrenceType = [self stringColumn:statement index:10];
    NSString *occurrencesJSON = [self stringColumn:statement index:14] ?: @"[]";
    NSArray *occurrences = [NSJSONSerialization JSONObjectWithData:[occurrencesJSON dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
    if (![occurrences isKindOfClass:[NSArray class]]) occurrences = @[];
    id recurrence = [NSNull null];
    if (recurrenceType.length > 0) {
        recurrence = @{
            @"type": recurrenceType,
            @"weekday": sqlite3_column_type(statement, 11) == SQLITE_NULL ? [NSNull null] : @(sqlite3_column_int(statement, 11)),
            @"start": [self stringColumn:statement index:12] ?: [NSNull null],
            @"end": [self stringColumn:statement index:13] ?: [NSNull null],
        };
    }
    return @{
        @"id": [self stringColumn:statement index:0] ?: @"",
        @"courseId": [self stringColumn:statement index:1] ?: @"",
        @"courseName": [self stringColumn:statement index:2] ?: @"",
        @"title": [self stringColumn:statement index:3] ?: @"",
        @"weight": @(sqlite3_column_double(statement, 4)),
        @"deadline": [self stringColumn:statement index:5] ?: [NSNull null],
        @"completed": sqlite3_column_int(statement, 6) != 0 ? @YES : @NO,
        @"isExam": sqlite3_column_int(statement, 7) != 0 ? @YES : @NO,
        @"priority": [self stringColumn:statement index:8] ?: @"normal",
        @"status": [self stringColumn:statement index:9] ?: @"none",
        @"recurrence": recurrence,
        @"completedOccurrences": occurrences,
        @"createdAt": [self stringColumn:statement index:15] ?: @"",
        @"updatedAt": [self stringColumn:statement index:16] ?: @"",
    };
}

- (NSDictionary *)courseById:(NSString *)courseId {
    if (courseId.length == 0) return nil;
    sqlite3_stmt *statement = NULL;
    if (sqlite3_prepare_v2(self.database, "SELECT id, name, created_at, updated_at FROM courses WHERE id = ?", -1, &statement, NULL) != SQLITE_OK) return nil;
    sqlite3_bind_text(statement, 1, courseId.UTF8String, -1, SQLITE_TRANSIENT);
    if (sqlite3_step(statement) != SQLITE_ROW) { sqlite3_finalize(statement); return nil; }
    NSDictionary *course = [self courseRecordFromStatement:statement];
    sqlite3_finalize(statement);
    return course;
}

- (NSDictionary *)courseByName:(NSString *)name {
    sqlite3_stmt *statement = NULL;
    if (sqlite3_prepare_v2(self.database, "SELECT id, name, created_at, updated_at FROM courses WHERE name = ? COLLATE NOCASE", -1, &statement, NULL) != SQLITE_OK) return nil;
    sqlite3_bind_text(statement, 1, name.UTF8String, -1, SQLITE_TRANSIENT);
    if (sqlite3_step(statement) != SQLITE_ROW) { sqlite3_finalize(statement); return nil; }
    NSDictionary *course = [self courseRecordFromStatement:statement];
    sqlite3_finalize(statement);
    return course;
}

- (NSDictionary *)courseRecordFromStatement:(sqlite3_stmt *)statement {
    NSString *courseId = [self stringColumn:statement index:0] ?: @"";
    NSInteger total = [self countForSQL:@"SELECT COUNT(*) FROM task_manager_tasks WHERE course_id = ?" binding:courseId];
    NSInteger completed = [self countForSQL:@"SELECT COUNT(*) FROM task_manager_tasks WHERE course_id = ? AND completed = 1" binding:courseId];
    return @{
        @"id": courseId,
        @"name": [self stringColumn:statement index:1] ?: @"",
        @"taskCount": @(total),
        @"completedTaskCount": @(completed),
        @"progressPercentage": @(total ? ((double)completed / (double)total) * 100.0 : 0.0),
        @"createdAt": [self stringColumn:statement index:2] ?: @"",
        @"updatedAt": [self stringColumn:statement index:3] ?: @"",
    };
}

- (NSInteger)countForSQL:(NSString *)sql {
    sqlite3_stmt *statement = NULL;
    if (sqlite3_prepare_v2(self.database, sql.UTF8String, -1, &statement, NULL) != SQLITE_OK) return 0;
    NSInteger count = sqlite3_step(statement) == SQLITE_ROW ? sqlite3_column_int(statement, 0) : 0;
    sqlite3_finalize(statement);
    return count;
}

- (NSInteger)countForSQL:(NSString *)sql binding:(NSString *)value {
    sqlite3_stmt *statement = NULL;
    if (sqlite3_prepare_v2(self.database, sql.UTF8String, -1, &statement, NULL) != SQLITE_OK) return 0;
    sqlite3_bind_text(statement, 1, value.UTF8String, -1, SQLITE_TRANSIENT);
    NSInteger count = sqlite3_step(statement) == SQLITE_ROW ? sqlite3_column_int(statement, 0) : 0;
    sqlite3_finalize(statement);
    return count;
}

- (NSInteger)revision {
    sqlite3_stmt *statement = NULL;
    if (sqlite3_prepare_v2(self.database, "SELECT value FROM metadata WHERE key = 'taskmanager_revision'", -1, &statement, NULL) != SQLITE_OK) return 0;
    NSInteger value = sqlite3_step(statement) == SQLITE_ROW ? [[[NSString alloc] initWithUTF8String:(const char *)sqlite3_column_text(statement, 0)] integerValue] : 0;
    sqlite3_finalize(statement);
    return value;
}

- (NSString *)metadataValue:(NSString *)key {
    sqlite3_stmt *statement = NULL;
    if (sqlite3_prepare_v2(self.database, "SELECT value FROM metadata WHERE key = ?", -1, &statement, NULL) != SQLITE_OK) return nil;
    sqlite3_bind_text(statement, 1, key.UTF8String, -1, SQLITE_TRANSIENT);
    NSString *value = sqlite3_step(statement) == SQLITE_ROW ? [self stringColumn:statement index:0] : nil;
    sqlite3_finalize(statement);
    return value;
}

- (void)setMetadataValue:(NSString *)value forKey:(NSString *)key {
    sqlite3_stmt *statement = NULL;
    if (sqlite3_prepare_v2(self.database, "INSERT OR REPLACE INTO metadata(key, value) VALUES (?, ?)", -1, &statement, NULL) != SQLITE_OK) return;
    sqlite3_bind_text(statement, 1, key.UTF8String, -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(statement, 2, value.UTF8String, -1, SQLITE_TRANSIENT);
    sqlite3_step(statement);
    sqlite3_finalize(statement);
}

- (NSInteger)bumpRevision {
    NSInteger value = [self revision] + 1;
    sqlite3_stmt *statement = NULL;
    if (sqlite3_prepare_v2(self.database, "INSERT OR REPLACE INTO metadata(key, value) VALUES ('taskmanager_revision', ?)", -1, &statement, NULL) == SQLITE_OK) {
        NSString *string = [NSString stringWithFormat:@"%ld", (long)value];
        sqlite3_bind_text(statement, 1, string.UTF8String, -1, SQLITE_TRANSIENT);
        sqlite3_step(statement);
        sqlite3_finalize(statement);
    }
    return value;
}

- (NSDictionary *)success:(NSDictionary *)data {
    return @{ @"ok": @YES, @"apiVersion": FDTaskManagerAPI, @"data": data };
}

- (NSDictionary *)errorWithCode:(NSString *)code message:(NSString *)message {
    return @{ @"ok": @NO, @"apiVersion": FDTaskManagerAPI, @"error": @{ @"code": code, @"message": message } };
}

- (NSDictionary *)sqliteError:(NSString *)code {
    return [self errorWithCode:code message:[self sqliteMessage]];
}

- (NSString *)stringValue:(id)value {
    return [value isKindOfClass:[NSString class]] ? value : nil;
}

- (NSString *)validPriority:(id)value {
    return [@[@"low", @"normal", @"high"] containsObject:value] ? value : nil;
}

- (NSString *)validStatus:(id)value {
    return [@[@"none", @"in-progress", @"ready-to-submit", @"important"] containsObject:value] ? value : nil;
}

- (NSString *)timestamp {
    return [[NSDate date] descriptionWithLocale:[NSLocale localeWithLocaleIdentifier:@"en_US_POSIX"]];
}

- (NSString *)stringColumn:(sqlite3_stmt *)statement index:(int)index {
    const unsigned char *value = sqlite3_column_text(statement, index);
    return value ? [NSString stringWithUTF8String:(const char *)value] : nil;
}

- (NSString *)sqliteMessage {
    const char *message = self.database ? sqlite3_errmsg(self.database) : NULL;
    return message ? [NSString stringWithUTF8String:message] : @"SQLite returned an unknown error.";
}

@end
