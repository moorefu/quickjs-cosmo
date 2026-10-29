import struct
import sys
from pathlib import Path
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from ape_layout import elf, printf_bytes


class ElfLayoutTests(unittest.TestCase):
    def image(self, alignment=65536, address=65536):
        data=bytearray(512)
        data[:7]=b'\x7fELF\x02\x01\x01'
        struct.pack_into('<HHIQQQIHHHHHH',data,16,2,183,1,address,64,0,0x101ca75,64,56,1,0,0,0)
        struct.pack_into('<IIQQQQQQ',data,64,1,5,0,address,address,512,512,alignment)
        return data

    def test_64k_requires_alignment_and_file_virtual_congruence(self):
        self.assertTrue(elf(self.image())['ready64k'])
        self.assertFalse(elf(self.image(16384))['ready64k'])
        self.assertFalse(elf(self.image(address=16384))['ready64k'])

    def test_reject_truncated_program_headers_and_payload(self):
        for change in ('headers','payload','entry','alignment'):
            data=self.image()
            if change=='headers':struct.pack_into('<Q',data,32,500)
            if change=='payload':struct.pack_into('<Q',data,64+32,513)
            if change=='entry':struct.pack_into('<Q',data,24,999999)
            if change=='alignment':struct.pack_into('<Q',data,64+48,65535)
            with self.subTest(change=change), self.assertRaises(ValueError):elf(data)

    def test_decode_real_shell_octal_including_wrapped_values(self):
        self.assertEqual(printf_bytes(rb'\177ELF\510\0\\'),b'\x7fELFH\0\\')
        with self.assertRaises(ValueError):printf_bytes(rb'\x7f')


if __name__=='__main__':unittest.main()
