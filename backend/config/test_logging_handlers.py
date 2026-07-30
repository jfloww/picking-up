import logging
import os
import tempfile
from unittest import TestCase, mock

from logging.handlers import TimedRotatingFileHandler

from config.logging_handlers import WindowsSafeTimedRotatingFileHandler


def _make_handler(cls, path):
    handler = cls(path, when="midnight", backupCount=1, delay=False)
    handler.setFormatter(logging.Formatter("%(message)s"))
    return handler


class WindowsSafeTimedRotatingFileHandlerTests(TestCase):
    def setUp(self):
        fd, self.path = tempfile.mkstemp()
        os.close(fd)
        self.addCleanup(lambda: os.path.exists(self.path) and os.remove(self.path))

    def test_base_handler_drops_the_record_when_rotation_hits_a_locked_file(self):
        # Establishes the bug this handler fixes: with the stock stdlib
        # handler, a PermissionError during rotation aborts emit() entirely
        # (see logging.handlers.BaseRotatingHandler.emit) — the record that
        # triggered the rollover is never written.
        handler = _make_handler(TimedRotatingFileHandler, self.path)
        handler.stream.close()
        with mock.patch.object(handler, "shouldRollover", return_value=1), mock.patch.object(
            handler, "rotate", side_effect=PermissionError("locked by another process")
        ):
            record = logging.LogRecord("test", logging.INFO, __file__, 1, "should be dropped", None, None)
            handler.handle(record)
        handler.close()

        with open(self.path, encoding="utf-8") as f:
            self.assertEqual(f.read(), "")

    def test_writes_the_record_instead_of_dropping_it_when_rotation_is_locked(self):
        handler = _make_handler(WindowsSafeTimedRotatingFileHandler, self.path)
        handler.stream.close()
        with mock.patch.object(handler, "shouldRollover", return_value=1), mock.patch.object(
            handler, "rotate", side_effect=PermissionError("locked by another process")
        ):
            record = logging.LogRecord(
                "test", logging.INFO, __file__, 1, "should still be written", None, None
            )
            handler.handle(record)
        handler.close()

        with open(self.path, encoding="utf-8") as f:
            self.assertIn("should still be written", f.read())

    def test_recovers_on_the_next_call_once_the_lock_clears(self):
        handler = _make_handler(WindowsSafeTimedRotatingFileHandler, self.path)
        handler.stream.close()
        with mock.patch.object(handler, "shouldRollover", return_value=1), mock.patch.object(
            handler, "rotate", side_effect=PermissionError("locked by another process")
        ):
            handler.handle(logging.LogRecord("test", logging.INFO, __file__, 1, "first", None, None))

        # Lock cleared: rollover succeeds normally on the next call.
        with mock.patch.object(handler, "shouldRollover", return_value=0):
            handler.handle(logging.LogRecord("test", logging.INFO, __file__, 1, "second", None, None))
        handler.close()

        with open(self.path, encoding="utf-8") as f:
            contents = f.read()
        self.assertIn("first", contents)
        self.assertIn("second", contents)
