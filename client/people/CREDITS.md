# Люди Флейм-Сити — источники и лицензии

Файлы этой папки (`*.glb`, `*.webp`, `people.json`) собраны скриптами `tools/fc-humans/` (run.sh: скачать → Blender →
атласы → сжатие) из двух бесплатных библиотек. Платных ассетов и Mixamo нет.

## Microsoft Rocketbox Avatar Library — MIT

Источник: https://github.com/microsoft/Microsoft-Rocketbox (Assets/Avatars, Assets/Animations).
Модели: Male_Adult_01, 03, 04, 06, 13, 17, 20; Female_Adult_01, 02, 04, 11, 12, 14, 17; Business_Male_02,
Business_Female_01; Police_Male_01, Security_Female_01, Medical_Male_02, Security_Male_01. Анимации m_/f_: стойки,
ходьба (обычная, «крутая», быстрая, прогулочная, старческая, пьяная), бег, телефон, жесты разговора, взмах рукой, смех,
пожатие плечами, хлопки, танец, присед, сидение на стуле и за столом, работа за столом, сесть/встать, съёмка на телефон.

Что изменено: скелет упрощён до 22 костей (веса лица и пальцев слиты в голову и кисти), текстуры уменьшены и собраны в
атлас 1024×512 с маской перекраски одежды, с формы сняты флаги, гербы, погоны и надписи (заплатки тканью), сделаны LOD,
клипы обрезаны в петли и переведены на свой скелет.

```
MIT License

Copyright (c) 2020 Microsoft

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Quaternius — Universal Animation Library (Standard) — CC0 1.0

Источник: официальная страница издателя в Godot Asset Store
(https://store.godotengine.org/asset/quaternius/universal-animation-library/), сайт https://quaternius.com.
Клипы: Punch_Cross, Punch_Jab, Hit_Head, Hit_Chest, Death01 (падение; «встать» — он же задом наперёд), Sprint_Loop,
Driving_Loop, Roll, Jump_Loop. Перенесены (ретаргет) со скелета Rigify на скелет Rocketbox.
Лицензия: CC0 1.0 Universal — https://creativecommons.org/publicdomain/zero/1.0/ (условий нет; спасибо автору).
