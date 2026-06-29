"""SEC: uploaded files are stored under MEDIA and served back same-origin, so an
unrestricted FileField is a stored-XSS vector. UploadSerializer.validate_file
allowlists business document/image/spreadsheet types and caps size."""
from unittest import mock

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase

from uploads.serializers import UploadSerializer


class UploadFileValidationTests(TestCase):
    def _file_errors(self, filename, content=b"x", content_type="application/octet-stream"):
        upload = SimpleUploadedFile(filename, content, content_type=content_type)
        serializer = UploadSerializer(data={"name": "doc", "file": upload})
        serializer.is_valid()
        return serializer.errors.get("file")

    def test_rejects_html(self):
        self.assertIsNotNone(self._file_errors("evil.html", b"<script>alert(1)</script>", "text/html"))

    def test_rejects_svg(self):
        self.assertIsNotNone(self._file_errors("evil.svg", b"<svg onload=alert(1)>", "image/svg+xml"))

    def test_rejects_js_and_extensionless(self):
        self.assertIsNotNone(self._file_errors("payload.js"))
        self.assertIsNotNone(self._file_errors("noextension"))

    def test_allows_xlsx(self):
        self.assertIsNone(self._file_errors("report.xlsx"))

    def test_allows_pdf_and_png(self):
        self.assertIsNone(self._file_errors("doc.pdf"))
        self.assertIsNone(self._file_errors("chart.PNG"))  # case-insensitive

    def test_rejects_oversized_file(self):
        with mock.patch("uploads.serializers.MAX_UPLOAD_BYTES", 4):
            self.assertIsNotNone(self._file_errors("big.pdf", b"way too big"))
