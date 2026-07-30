from logging.handlers import TimedRotatingFileHandler


class WindowsSafeTimedRotatingFileHandler(TimedRotatingFileHandler):
    """A TimedRotatingFileHandler that tolerates a locked rotation target.

    On Windows, renaming a file that another process still has open raises
    PermissionError — and Django's dev autoreloader keeps a second process
    (the file-watcher) alive for the whole `runserver` session, holding this
    same log file open. The base class lets that error escape doRollover(),
    which aborts emit() before the record is ever written (see
    logging.handlers.BaseRotatingHandler.emit) — every log call is silently
    dropped, not just delayed, for as long as the lock persists.

    Rotation is simply deferred here until whichever process holds the lock
    releases it; the record that triggered the attempt still gets written.
    """

    def doRollover(self):
        try:
            super().doRollover()
        except PermissionError:
            if not self.delay:
                self.stream = self._open()
