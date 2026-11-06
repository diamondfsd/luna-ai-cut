//! Optional stage reporting for the long single-call pipelines.
//!
//! `align` and `render_preview` each run as one uninterruptible call, and on
//! a large set either can sit for minutes inside a single stage. A caller
//! driving them from a worker thread has no way to tell that apart from a
//! hang, so stages announce themselves through a thread-local hook. Native
//! builds leave it unset and pay nothing.

use std::cell::RefCell;

type Reporter = Box<dyn Fn(&str)>;

thread_local! {
    static HOOK: RefCell<Option<Reporter>> = const { RefCell::new(None) };
}

/// Installs `f` as this thread's stage reporter until the returned guard is
/// dropped, restoring whatever was installed before.
///
/// The reporter runs while the hook slot is borrowed, so it must not call
/// back into the engine or install another reporter.
pub fn scoped(f: Reporter) -> Guard {
    Guard(HOOK.with(|h| h.borrow_mut().replace(f)))
}

/// Restores the previous reporter on drop.
pub struct Guard(Option<Reporter>);

impl Drop for Guard {
    fn drop(&mut self) {
        let prev = self.0.take();
        HOOK.with(|h| *h.borrow_mut() = prev);
    }
}

/// Announces that `label` is starting. A cheap no-op with no hook installed.
pub fn stage(label: &str) {
    HOOK.with(|h| {
        if let Some(f) = h.borrow().as_ref() {
            f(label);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::rc::Rc;

    #[test]
    fn reports_only_while_a_guard_is_alive() {
        // No hook installed: must be a silent no-op, not a panic.
        stage("before");

        let seen: Rc<RefCell<Vec<String>>> = Rc::new(RefCell::new(Vec::new()));
        {
            let sink = Rc::clone(&seen);
            let _g = scoped(Box::new(move |s| sink.borrow_mut().push(s.to_string())));
            stage("orb-detect");
            stage("match-pairs");
        }
        stage("after-drop");
        assert_eq!(*seen.borrow(), ["orb-detect", "match-pairs"]);
    }

    #[test]
    fn nested_guards_restore_the_outer_reporter() {
        let outer: Rc<RefCell<Vec<String>>> = Rc::new(RefCell::new(Vec::new()));
        let inner: Rc<RefCell<Vec<String>>> = Rc::new(RefCell::new(Vec::new()));
        let o = Rc::clone(&outer);
        let _g = scoped(Box::new(move |s| o.borrow_mut().push(s.to_string())));
        stage("a");
        {
            let i = Rc::clone(&inner);
            let _g2 = scoped(Box::new(move |s| i.borrow_mut().push(s.to_string())));
            stage("b");
        }
        stage("c");
        assert_eq!(*outer.borrow(), ["a", "c"]);
        assert_eq!(*inner.borrow(), ["b"]);
    }
}
