//! AppKit's documented applicationDockMenu: callback supplies the Dock menu.
//! Keep Tao's existing delegate and add only its otherwise unimplemented hook.
use objc2::{
    define_class, msg_send,
    rc::Retained,
    runtime::{AnyClass, AnyObject, Sel},
    sel, DeclaredClass, MainThreadOnly,
};
use objc2_app_kit::{NSApplication, NSMenu, NSMenuItem};
use objc2_foundation::{MainThreadMarker, NSObject, NSObjectProtocol, NSString};
use serde_json::{json, Value};
use std::{
    cell::RefCell,
    ffi::{c_char, c_void},
};

pub struct Actions {
    app: tauri::AppHandle,
    ids: Vec<String>,
}
define_class!(
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[ivars = Actions]
    struct IsletDockActions;
    unsafe impl NSObjectProtocol for IsletDockActions {}
    impl IsletDockActions {
        #[unsafe(method(openRecent:))]
        fn open_recent(&self, item: &NSMenuItem) {
            if let Some(id) = self.ivars().ids.get(item.tag() as usize).cloned() {
                let app = self.ivars().app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(error) = crate::recent::open(app.clone(), &id).await {
                        use tauri::Emitter;
                        let _ = app.emit("host-event", json!({"type":"recent-open-error","message":error}));
                    }
                });
            }
        }
    }
);
struct DockMenu {
    menu: Retained<NSMenu>,
    _target: Retained<IsletDockActions>,
    titles: Vec<String>,
}
thread_local! { static MENU: RefCell<Option<DockMenu>> = const { RefCell::new(None) }; }
#[link(name = "objc")]
unsafe extern "C" {
    fn class_addMethod(
        class: *const AnyClass,
        selector: Sel,
        implementation: *const c_void,
        types: *const c_char,
    ) -> bool;
}
extern "C" fn application_dock_menu(
    _: *mut AnyObject,
    _: Sel,
    _: *mut AnyObject,
) -> *mut AnyObject {
    MENU.with(|value| {
        value
            .borrow()
            .as_ref()
            .map(|value| Retained::as_ptr(&value.menu) as *mut AnyObject)
            .unwrap_or(std::ptr::null_mut())
    })
}
pub fn install() -> Result<(), String> {
    let mtm = MainThreadMarker::new().ok_or("Dock menu requires the main thread")?;
    let app = NSApplication::sharedApplication(mtm);
    let delegate = app
        .delegate()
        .ok_or("Application delegate is unavailable")?;
    let object: &AnyObject = delegate.as_ref();
    unsafe {
        if !class_addMethod(
            object.class(),
            sel!(applicationDockMenu:),
            application_dock_menu as *const c_void,
            c"@@:@".as_ptr(),
        ) {
            return Err("The application delegate already provides a Dock menu".into());
        }
    }
    Ok(())
}
pub fn refresh(app: tauri::AppHandle, entries: Value) {
    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };
    let rows: Vec<_> = entries.as_array().into_iter().flatten().take(4).collect();
    let ids = rows
        .iter()
        .filter_map(|row| row["id"].as_str().map(str::to_owned))
        .collect();
    let target: Retained<IsletDockActions> = unsafe {
        msg_send![
            super(
                mtm.alloc::<IsletDockActions>()
                    .set_ivars(Actions { app, ids })
            ),
            init
        ]
    };
    let menu = NSMenu::new(mtm);
    menu.setAutoenablesItems(false);
    let mut titles = vec![];
    for (index, row) in rows.iter().enumerate() {
        let title = row["name"].as_str().unwrap_or("Project");
        let item = unsafe {
            NSMenuItem::initWithTitle_action_keyEquivalent(
                mtm.alloc(),
                &NSString::from_str(title),
                Some(sel!(openRecent:)),
                &NSString::from_str(""),
            )
        };
        item.setTag(index as isize);
        unsafe {
            item.setTarget(Some(&target));
        }
        menu.addItem(&item);
        titles.push(title.to_owned());
    }
    MENU.with(|value| {
        *value.borrow_mut() = Some(DockMenu {
            menu,
            _target: target,
            titles,
        })
    });
}
#[cfg(debug_assertions)]
pub fn inspect(action: Option<usize>) -> Value {
    MENU.with(|value| {
        let value = value.borrow();
        if let Some(value) = value.as_ref() {
            if let Some(index) = action {
                value.menu.performActionForItemAtIndex(index as isize);
            }
            json!(value.titles)
        } else {
            json!([])
        }
    })
}
