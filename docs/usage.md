# Using AnimaPage

A guide for teachers, students and parents. Italian version: [guida.md](guida.md).

AnimaPage turns a photo of a page of a study book into an animated 3D lesson. The lesson has a voice
that reads it, labels on the scene, questions, a small activity and the list of its sources. You can keep
the lesson and share it as a file that works without the internet.

The names of buttons and menus below are the ones the app shows in English. The app speaks your language:
if it is set to another language, the names change with it.

## Which pages work best

- **A page of a study book**: any subject (history, geography, science, maths, grammar, art, music,
  languages...), any language.
- **The whole page in the photo**, all four corners inside.
- **The book flat**, the phone parallel to the page, not at an angle.
- **Good light**: near a window or under a lamp, with no shadows (watch out for the phone's own shadow)
  and no glare.
- **A sharp photo**: tap the page on the screen to focus and keep the phone still. Small print must be
  readable.

AnimaPage is meant for study-book pages. It is not a general tool for any photo of any text. It is in an
early stage and has been tried on few real pages: some pages will not work well.

Do not photograph pages with personal data (pupils' names, grades, faces). See [Privacy](#privacy).

## Getting started

Someone has to install AnimaPage on a computer first: the steps are in the README,
[Quick start](../README.md#quick-start). Then open the app in the browser (on that computer it is
usually `http://localhost:5173`).

<!-- screenshot: home page -->

The home page has:

- **Take a photo**: opens the camera (on a phone or tablet). The first time it shows **Tips for a good
  photo**; you can tick **Don't show these tips again**.
- **Upload a photo**: pick a photo you already have.
- **Paste a photo**: paste a photo you copied (you can also press Ctrl+V).
- **Theme**: the colours of the app: Notebook, Starry night, Laboratory, Blackboard, Parchment.
- **Settings · Language and AI model**: see [Settings](#settings).
- **My lessons**: every lesson you made from a photo is saved here. Use the search box to find one; the
  menu next to a lesson lets you **Open**, **Rename** or **Delete** it.
- **Examples**: ready-made lessons. They work even without the internet. Try one first.

### Making a lesson from a photo

1. Take, upload or paste the photo. The app asks **Is this the right page?**: choose **Create the
   lesson**, or **Change photo**.
2. Wait. The steps are shown on screen. Meanwhile the app tells you **What the page is about** (you can
   **Stop the voice**).
3. The first chapter opens after about a minute and a half, while the others are still being made
   ("First chapter ready: preparing the others meanwhile…"). The whole lesson usually takes a few minutes.
4. The lesson is saved in **My lessons**.

### Settings

- **Language**: the language of the app, of the lessons made from photos and of the voice.
  **Automatic** follows the device.
- **Lesson style**: **Pop-up book** (for children and teenagers: the lesson rises from an open paper
  book) or **Academic** (sober, for university and adult readers: no paper book, typeset formulas, stamps
  and sound effects off). **Automatic** chooses from the level of the page.
- **AI model**: which AI is used to read the photo, build the scene and check it. The default is usually
  right; this is mostly for whoever installed the app. **Restore the defaults** puts everything back.

The choices stay on this device.

## The lesson screen

<!-- screenshot: a lesson, pop-up book style -->

On one side is the **3D scene**; on the other, the text of the chapter, the questions and the other cards.

- **Chapters**: the lesson is split into short chapters. Tap a chapter's name to go to it.
- **Play / Pause** and the **timeline**: drag the timeline to go to a moment of the chapter. The ⏮ and ⏭
  arrows go to the previous and next chapter.
- **Guided tour**: plays the chapters one after the other, like a short film, and waits for you at each
  activity. **Stop the tour** to look around on your own.
- **Voice**, **Sounds**, **Auto-advance** and, in some lessons, **Music**: switch the narration voice, the
  sound effects, the automatic move to the next chapter and the background music on or off.
- **Labels**: tap to switch between **All**, **Active only** (the ones of the current moment) and
  **Hidden**.
- **Style**: **Colour** or **Ink** (a black-and-white drawing look).
- **Center**: puts the scene back in the middle.
- **Moving around the scene**: on a computer, drag to rotate, right button to pan, mouse wheel to zoom,
  arrow keys or WASD to move. On a touch screen, drag with one finger to rotate, two fingers to pan and
  zoom; tap ✥ for the movement buttons.
- **Theme**: the colours, as on the home page.

### Predict → Try → Explain, and the stamps

Many chapters have a small activity card in three steps:

1. **Predict**: choose what you think will happen. The answer stays hidden until the end.
2. **Try**: watch the scene or move the sliders (**Try it:**). **Reset** puts the sliders back.
3. **Explain ▸**: lift the flap (**▲ lift the flap**) to read why it happens and check your prediction.

Each activity you finish gives a **stamp**. The **Stamps** card shows the ones you have earned. In the
Academic style stamps are off; you can switch them on in the lesson. You can **Fold the card** if it
covers the scene.

### Questions

The **Questions** card has quiz questions on the chapter. Some are answered by tapping a label on the
3D scene (**Answer in the scene**). If you are stuck, use **Show the answer**. At the end, **See the
result**.

### Learn more, videos and sources

- **Learn more**: extra details on the chapter, which you can also listen to.
- **Videos** (some lessons): a video loads only when you choose **Load the video**. YouTube videos use
  YouTube's privacy-enhanced mode.
- **Sources**: where each fact comes from: the photographed page, Wikipedia, Wikidata, open map data and
  so on, with the licence of each. The small numbers in the text (like [1]) point to them. Sources matter
  because the lesson is written by an AI: when the book and the sources disagree, the lesson shows both
  values instead of silently correcting the book. Use the sources to check, and keep them when you share
  a lesson.

### Stories for young children

The **Stories** lessons are for children of about 5 or 6. A cartoon story is told with sounds
that play exactly on the word the voice is saying. Each chapter can end with a small game:

- touch the characters to hear them;
- find the things that start with the page's letter;
- put the characters in order, from the biggest to the smallest;
- colour a character with the **Colours** palette.

Every game ends with a stamp ("Well done!"). Nothing ever says "wrong": a mistaken touch only makes the
character wobble.

### Augmented reality (Android)

On an Android phone with Chrome and "Google Play Services for AR", the button **See it on the table
(AR)** puts the 3D book on a real table through the camera. Point the phone at the table and move it
slowly, then tap to place the book; one finger moves it, two fingers rotate and resize it. AR needs the
secure (HTTPS) phone setup described below and is not available in exported files.

## Export: keep and share a lesson

<!-- screenshot: the Export menu -->

In a lesson, open **Export**:

- **Interactive lesson (.html)**: one file that opens in any modern browser (Chrome, Edge, Firefox...),
  even without the internet. It has the 3D scene, the voice of the browser, the sounds, labels,
  questions, activities and stamps. Stamps are kept in that browser; **Start over** clears them for the
  next class. Videos and source links still need the internet. AR is not available.
- **Widget for OpenBoard (.wgt)**: the same lesson for the OpenBoard interactive whiteboard software.
  Open OpenBoard and drag the `.wgt` file onto a page of the board. The OpenBoard version is still being
  tested: if the voice does not work there, the lesson shows the text only.

The file is usually 3 to 4 MB, sometimes more. An exported file does not change when the app is updated.
While a new lesson is still being made, **Export** appears only once all its chapters are ready.

Lessons from **My lessons** can be exported only while the AnimaPage server is running ("To export this
lesson the AnimaPage server must be running"). Examples always export.

A lesson made from a page of a protected book summarises that page: do not publish or pass it on outside
your class without the publisher's permission. See [Privacy](#privacy) and the README,
[Legal and privacy](../README.md#legal-and-privacy).

## On a phone or tablet

The phone opens the app from the computer where AnimaPage is installed, over the same Wi-Fi. This needs a
developer setup on that computer (`pnpm dev:phone`, which serves the app over HTTPS so the camera and AR
work): see [dev-setup.md](dev-setup.md#phone-m5). Once it is running, open on the phone the address it
prints, and use **Take a photo**.

## Privacy

AnimaPage does not store your photo. It **does send it** to the AI service that reads the page and builds
the lesson: by default Claude (Anthropic) through the Claude Code program on the computer that runs
AnimaPage, or another service chosen by whoever installed it. That service's terms and privacy policy
apply. Some words from the page are also sent, as text searches, to Wikipedia, Wikidata and Wikimedia
Commons (and to YouTube only if it has been enabled). The saved lesson keeps the text of the page, not
the photo. AnimaPage has no accounts and no tracking. **Do not photograph pages with personal data**
(pupils' names, grades, recognisable handwriting, faces). If a school uses AnimaPage with pupils, the
school is responsible for data protection (in the EU, the GDPR). Lessons are written by an AI and can
contain mistakes: a teacher or another adult should look a lesson over before using it with a class.

## Troubleshooting

- **No voice.** The voice comes from the browser and the device. If there is no voice for the lesson's
  language, the app says so and highlights the text sentence by sentence instead. Try another browser
  (Chrome and Edge usually have more voices) or add a voice for that language in the device's settings.
  Check that **Voice** is on and the volume is up.
- **"I can't read the page well."** Take the photo again with more light, holding the phone still and
  framing the whole page. Very dark, blurred or slanted photos fail; so do photos that are not of a book
  page.
- **"In test mode I only recognise the example pages."** The server is running in test mode: whoever
  installed AnimaPage has to switch it to live mode (see the README, Quick start).
- **It is slow.** A lesson takes a few minutes; the first chapter opens after about a minute and a half.
  This is normal. Time depends on the AI service and the computer.
- **The server cannot be reached.** Check that the computer running AnimaPage is on, that the server is
  started, and that the phone is on the same Wi-Fi. The examples work anyway.
- **Only a simple card, no 3D scene.** Sometimes the 3D scene cannot be built and the lesson falls back
  to a card with the explanation. Try again with a sharper photo.
- **The lesson has mistakes.** Check against the book and the **Sources**. You can make the lesson again
  from a new photo, or try another AI model in **Settings**. Please tell us about it (see below).
- **The 3D scene does not appear.** The browser may not support 3D graphics (WebGL). Explanations, voice
  and questions still work. Try an up-to-date Chrome, Edge or Firefox.

## Feedback

Feedback is very welcome, especially from teachers, students and publishers: which pages work, which
fail, and what a lesson should do. Please open an issue on the project's repository. Do not attach photos
of protected pages or of pupils; describe the page instead (subject, school year, language).
