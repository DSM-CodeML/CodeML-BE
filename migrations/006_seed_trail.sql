-- 트레일 1(대표 학습 경로)과 "Printing & formatting" 레슨 문제. 내용은 프론트 trail.html 에 하드코딩된 화면과 같다.

INSERT INTO trails (id, ord, eyebrow, title) VALUES
 (1, 1, 'Trail 1 · Core path', 'AI Engineer Curriculum');

-- Ch 2~4 는 아직 레슨이 없는 빈 챕터다.
INSERT INTO trail_chapters (id, trail_id, ord, title) VALUES
 (1, 1, 1, 'Python Basics'),
 (2, 1, 2, 'AI Fundamentals'),
 (3, 1, 3, 'Algorithms'),
 (4, 1, 4, 'Machine Learning');

INSERT INTO trail_lessons (id, chapter_id, ord, title, tag) VALUES
 (1, 1, 1, 'Hello, World', 'Foundation'),
 (2, 1, 2, 'Variables & types', 'Foundation'),
 (3, 1, 3, 'Printing & formatting', 'Foundation'),
 (4, 1, 4, 'Input & output', 'Foundation'),
 (5, 1, 5, 'Conditionals', 'Foundation'),
 (6, 1, 6, 'Loops', 'Foundation'),
 (7, 1, 7, 'Functions', 'Foundation');

-- Printing & formatting 레슨 문제 (1주차, Easy, 10 XP). 해설/개념은 004 와 같은 형식의 짧은 문서다.
INSERT INTO problems (id, week_n, title, level, xp, chapter, statement_html, solution_html, concept_html, starter_code) VALUES
 (6, '1', 'Print a word', 'Easy', 10, 'Printing',
  '<p>Print the word <code>Python</code>.</p>',
  '<p>Put the word in quotes and pass it to <code>print</code>.</p><pre>print("Python")</pre>',
  '<p>Text in quotes is a string. <code>print()</code> writes it to the screen.</p>',
  '# Print Python\n'),
 (7, '1', 'Print a sentence', 'Easy', 10, 'Printing',
  '<p>Print the sentence <code>I am learning Python.</code> exactly as shown.</p>',
  '<p>Spaces and the period are part of the string.</p><pre>print("I am learning Python.")</pre>',
  '<p>A string keeps every character inside the quotes, including spaces and punctuation.</p>',
  '# Print the sentence\n'),
 (8, '1', 'Print with quotes', 'Easy', 10, 'Printing',
  '<p>Print <code>She said "Hi!"</code> including the double quotes.</p>',
  '<p>Wrap the text in single quotes so the double quotes stay inside the string.</p><pre>print(''She said "Hi!"'')</pre>',
  '<p>Python strings can use single or double quotes. Use the other kind to include quotes in the text.</p>',
  '# Print: She said "Hi!"\n'),
 (9, '1', 'Print two lines', 'Easy', 10, 'Printing',
  '<p>Print <code>Hello</code> on the first line and <code>World</code> on the second line.</p>',
  '<p>Call <code>print</code> twice, or use <code>\\n</code> inside one string.</p><pre>print("Hello")\nprint("World")</pre>',
  '<p>Each <code>print()</code> ends with a newline. <code>\\n</code> starts a new line inside a string.</p>',
  '# Print Hello and World on two lines\n'),
 (10, '1', 'Print a name', 'Easy', 10, 'Printing',
  '<p>Read a name from input and print <code>My name is NAME.</code></p>',
  '<p>Use an f-string to put the variable into the sentence.</p><pre>name = input()\nprint(f"My name is {name}.")</pre>',
  '<p>An f-string (<code>f"..."</code>) replaces <code>{name}</code> with the value of <code>name</code>.</p>',
  'name = input()\n# Print: My name is NAME.\n'),
 (11, '1', 'Print a greeting', 'Easy', 10, 'Printing',
  '<p>Read a name from input and print <code>Hello, NAME!</code></p>',
  '<p>Format the greeting with an f-string.</p><pre>name = input()\nprint(f"Hello, {name}!")</pre>',
  '<p>f-strings can mix fixed text and variables in one line.</p>',
  'name = input()\n# Print: Hello, NAME!\n'),
 (12, '1', 'Print it your way', 'Easy', 10, 'Printing',
  '<p>The input has a name on the first line and an age on the second line. Print <code>NAME is AGE years old.</code></p>',
  '<p>Read both lines, then format them into one sentence.</p><pre>name = input()\nage = input()\nprint(f"{name} is {age} years old.")</pre>',
  '<p>You can put several variables in one f-string.</p>',
  'name = input()\nage = input()\n# Print: NAME is AGE years old.\n');

INSERT INTO problem_cases (problem_id, ord, input_text, expected_output, is_sample) VALUES
 (6, 1, '', 'Python', 1),
 (7, 1, '', 'I am learning Python.', 1),
 (8, 1, '', 'She said "Hi!"', 1),
 (9, 1, '', 'Hello\nWorld', 1),
 (10, 1, 'Alex', 'My name is Alex.', 1),
 (10, 2, 'Kim Minji', 'My name is Kim Minji.', 0),
 (11, 1, 'Alex', 'Hello, Alex!', 1),
 (11, 2, 'CodeML', 'Hello, CodeML!', 0),
 (12, 1, 'Alex\n17', 'Alex is 17 years old.', 1),
 (12, 2, 'Minji\n9', 'Minji is 9 years old.', 0);

-- 1주차 목표 문제 수(total)를 등록된 문제 수(1~12번)에 맞춘다. (커리큘럼 화면의 "x / total solved")
UPDATE weeks SET total = 12 WHERE n = '1';

-- 레슨 ↔ 문제. 기존 1~5번은 내용에 맞는 레슨에 연결하고, Loops / Functions 는 아직 문제가 없다.
INSERT INTO trail_lesson_problems (lesson_id, problem_id, step, ord) VALUES
 (1, 1, 'basic', 1),     -- Hello, World      : Hello, World
 (2, 3, 'basic', 1),     -- Variables & types : Add two numbers (int 변환)
 (3, 6, 'basic', 1),     -- Printing & formatting
 (3, 7, 'basic', 2),
 (3, 8, 'basic', 3),
 (3, 9, 'basic', 4),
 (3, 10, 'practice', 1),
 (3, 11, 'practice', 2),
 (3, 12, 'test', 1),
 (4, 2, 'basic', 1),     -- Input & output    : Echo a line
 (4, 4, 'practice', 1),  --                     Count words
 (5, 5, 'basic', 1);     -- Conditionals      : Number guessing hint
