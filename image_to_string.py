import pytesseract
pytesseract.pytesseract.tesseract_cmd = r'C:\Users\ASUS\AppData\Local\Tesseract-OCR\tesseract.exe' 
import cv2 # For loading image
img = cv2.imread('one.jpg')
text = pytesseract.image_to_string(
    img, config='-l eng --oem 1 --psm 6'
)

with open('output.txt', 'a') as f:
    f.write(text)

    