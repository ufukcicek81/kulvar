"""Basit zipalign: STORED girdilerin verisini 4 bayta hizalar (zipalign -p 4 eşdeğeri)."""
import sys
import zipfile

src, dst = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(src) as zin, zipfile.ZipFile(dst, 'w') as zout:
    for info in zin.infolist():
        data = zin.read(info.filename)
        out = zipfile.ZipInfo(info.filename, date_time=info.date_time)
        out.compress_type = info.compress_type
        out.external_attr = info.external_attr
        if info.compress_type == zipfile.ZIP_STORED:
            header_end = zout.fp.tell() + 30 + len(info.filename.encode('utf-8'))
            out.extra = b'\x00' * ((4 - header_end % 4) % 4)
        zout.writestr(out, data)
