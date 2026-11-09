import glob, os
import numpy as np
import cv2

classes = ["Apple___Apple_scab","Apple___Black_rot","Apple___Cedar_apple_rust","Apple___healthy"]
labels  = ["Apple_scab","Black_rot","Cedar_rust","Healthy"]
S = 260
rows = []
for c, lab in zip(classes, labels):
    files = sorted(glob.glob(os.path.join("pv","raw","color",c,"*")))[:2]
    imgs = []
    for f in files:
        im = cv2.imread(f)
        h, w = im.shape[:2]
        im = cv2.resize(im, (S, S), interpolation=cv2.INTER_AREA)
        cv2.rectangle(im, (0,0), (S-1,S-1), (0,255,0), 1)
        cv2.putText(im, lab if S==S else "", (4,16), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0,255,0), 1)
        imgs.append(im)
    rows.append(np.hstack(imgs))
sheet = np.vstack(rows)
sheet = cv2.resize(sheet, (S*2*2, S*4*2), interpolation=cv2.INTER_CUBIC)
os.makedirs("docs", exist_ok=True)
cv2.imwrite("docs/preview.jpg", sheet)
print("saved docs/preview.jpg", sheet.shape)
# 抽样检查背景是否均匀：看四角像素的标准差
for c in classes:
    f = sorted(glob.glob(os.path.join("pv","raw","color",c,"*")))[0]
    im = cv2.imread(f)
    corners = np.array([im[0,0], im[0,-1], im[-1,0], im[-1,-1]], dtype=np.float32)
    print(f"{c:28s} shape={im.shape} corner_mean={corners.mean(axis=0).round(1)} corner_std={corners.std(axis=0).round(1)}")
