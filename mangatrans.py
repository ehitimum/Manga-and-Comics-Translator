import googletrans
from googletrans import Translator, LANGUAGES
import pytesseract

from translator import Output_text
pytesseract.pytesseract.tesseract_cmd = r'C:\Users\ASUS\AppData\Local\Tesseract-OCR\tesseract.exe' 
import cv2 # For loading image


language = list(LANGUAGES.values())
for item in language:
    if item == "japanese":
        dest_lang = item
    if item == "english":
        src_lang = item

def Translate():
    translator = Translator()

    translated=translator.translate(text=texten,
    src=src_lang, dest=dest_lang)
    return translated.text

img = cv2.imread('one.jpg')
texten = pytesseract.image_to_string(
    img, config='-l eng --oem 1 --psm 6'
)

translated_text = Translate()
print(translated_text)