#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>
#import "Bridge/FDMessageBridge.h"

@interface FocusDeskDelegate : NSObject <NSApplicationDelegate, WKNavigationDelegate>
@property (strong) NSWindow *window;
@property (strong) WKWebView *webView;
@property (strong) FDMessageBridge *messageBridge;
@end

@implementation FocusDeskDelegate

- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    [NSApp setActivationPolicy:NSApplicationActivationPolicyRegular];
    [self createMainMenu];

    WKUserContentController *controller = [WKUserContentController new];
    self.messageBridge = [FDMessageBridge new];
    [controller addScriptMessageHandlerWithReply:self.messageBridge
                                    contentWorld:WKContentWorld.pageWorld
                                            name:@"focusDesk"];
    WKUserScript *bridge = [[WKUserScript alloc]
        initWithSource:[FDMessageBridge userScriptSource]
        injectionTime:WKUserScriptInjectionTimeAtDocumentStart
        forMainFrameOnly:YES];
    [controller addUserScript:bridge];

    WKWebViewConfiguration *configuration = [WKWebViewConfiguration new];
    configuration.userContentController = controller;
    configuration.websiteDataStore = [WKWebsiteDataStore defaultDataStore];

    self.webView = [[WKWebView alloc] initWithFrame:NSZeroRect configuration:configuration];
    self.webView.navigationDelegate = self;

    NSWindowStyleMask style = NSWindowStyleMaskTitled | NSWindowStyleMaskClosable |
        NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskResizable | NSWindowStyleMaskFullSizeContentView;
    self.window = [[NSWindow alloc]
        initWithContentRect:NSMakeRect(0, 0, 1380, 900)
        styleMask:style
        backing:NSBackingStoreBuffered
        defer:NO];
    self.window.title = @"FocusDesk";
    self.window.titlebarAppearsTransparent = YES;
    self.window.titleVisibility = NSWindowTitleHidden;
    self.window.minSize = NSMakeSize(900, 620);
    self.window.contentView = self.webView;
    [self.window center];
    [self.window setFrameAutosaveName:@"FocusDeskMainWindow"];

    NSURL *webRoot = [[[NSBundle mainBundle] resourceURL] URLByAppendingPathComponent:@"web"];
    NSURL *indexURL = [webRoot URLByAppendingPathComponent:@"index.html"];
    if (![[NSFileManager defaultManager] fileExistsAtPath:indexURL.path]) {
        [NSException raise:@"FocusDeskResourcesMissing" format:@"FocusDesk web resources are missing"];
    }

    [self.webView loadFileURL:indexURL allowingReadAccessToURL:webRoot];
    [self.window makeKeyAndOrderFront:nil];
    [NSApp activateIgnoringOtherApps:YES];
}

- (void)webView:(WKWebView *)webView
    decidePolicyForNavigationAction:(WKNavigationAction *)navigationAction
    decisionHandler:(void (^)(WKNavigationActionPolicy))decisionHandler {
    NSURL *url = navigationAction.request.URL;
    NSString *scheme = url.scheme.lowercaseString;
    if (navigationAction.navigationType == WKNavigationTypeLinkActivated &&
        ([scheme isEqualToString:@"http"] || [scheme isEqualToString:@"https"])) {
        [[NSWorkspace sharedWorkspace] openURL:url];
        decisionHandler(WKNavigationActionPolicyCancel);
        return;
    }
    decisionHandler(WKNavigationActionPolicyAllow);
}

- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender { return YES; }

- (void)createMainMenu {
    NSMenu *menu = [NSMenu new];
    NSMenuItem *appItem = [NSMenuItem new];
    [menu addItem:appItem];
    NSMenu *appMenu = [[NSMenu alloc] initWithTitle:@"FocusDesk"];
    [appMenu addItemWithTitle:@"About FocusDesk" action:@selector(orderFrontStandardAboutPanel:) keyEquivalent:@""];
    [appMenu addItem:[NSMenuItem separatorItem]];
    [appMenu addItemWithTitle:@"Hide FocusDesk" action:@selector(hide:) keyEquivalent:@"h"];
    [appMenu addItem:[NSMenuItem separatorItem]];
    [appMenu addItemWithTitle:@"Quit FocusDesk" action:@selector(terminate:) keyEquivalent:@"q"];
    appItem.submenu = appMenu;

    NSMenuItem *editItem = [NSMenuItem new];
    [menu addItem:editItem];
    NSMenu *editMenu = [[NSMenu alloc] initWithTitle:@"Edit"];
    [editMenu addItemWithTitle:@"Undo" action:@selector(undo:) keyEquivalent:@"z"];
    [editMenu addItemWithTitle:@"Redo" action:@selector(redo:) keyEquivalent:@"Z"];
    [editMenu addItem:[NSMenuItem separatorItem]];
    [editMenu addItemWithTitle:@"Cut" action:@selector(cut:) keyEquivalent:@"x"];
    [editMenu addItemWithTitle:@"Copy" action:@selector(copy:) keyEquivalent:@"c"];
    [editMenu addItemWithTitle:@"Paste" action:@selector(paste:) keyEquivalent:@"v"];
    [editMenu addItemWithTitle:@"Select All" action:@selector(selectAll:) keyEquivalent:@"a"];
    editItem.submenu = editMenu;
    NSApp.mainMenu = menu;
}

@end

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        NSApplication *application = [NSApplication sharedApplication];
        FocusDeskDelegate *delegate = [FocusDeskDelegate new];
        application.delegate = delegate;
        [application run];
    }
    return 0;
}
