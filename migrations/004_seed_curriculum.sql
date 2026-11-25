-- 초기 커리큘럼(노션 기능명세서의 주차별 표)과 1주차 시작 문제. 해설/개념은 더미 문서다.

INSERT INTO weeks (n, ord, course, libs, project, optional, total) VALUES
 ('1', 1, 'Intro to Programming, Python', 'None (pure Python)', 'Number guessing game, word counter', 0, 5),
 ('2', 2, 'Pandas', 'pandas', 'Average score per country from wine reviews', 0, 6),
 ('3', 3, 'Data Visualization, Data Cleaning', 'matplotlib, seaborn, pandas', 'Fill missing values, then draw bar and line charts', 0, 6),
 ('4', 4, 'Intro to Machine Learning', 'scikit-learn, pandas', 'Decision tree for house prices', 0, 6),
 ('5-6', 5, 'Intermediate ML, Feature Engineering, Time Series', 'scikit-learn, pandas', 'Missing/categorical pipeline, moving average', 1, 8);

INSERT INTO problems (id, week_n, title, level, xp, chapter, statement_html, solution_html, concept_html, starter_code) VALUES
 (1, '1', 'Hello, World', 'Easy', 10, 'Python basics',
  '<p>Print <code>Hello, World!</code> to the screen.</p>',
  '<p>Use <code>print</code> with a string.</p><pre>print("Hello, World!")</pre>',
  '<p><code>print()</code> writes text to standard output and adds a newline.</p>',
  '# Write your code here\n'),
 (2, '1', 'Echo a line', 'Easy', 10, 'Python basics',
  '<p>Read one line from input and print it as it is.</p>',
  '<p><code>input()</code> returns the line without the trailing newline.</p><pre>print(input())</pre>',
  '<p><code>input()</code> reads one line from standard input as a string.</p>',
  'text = input()\n# Print text\n'),
 (3, '1', 'Add two numbers', 'Easy', 10, 'Python basics',
  '<p>The input has two integers on one line, separated by a space. Print their sum.</p>',
  '<p>Split the line, convert each part with <code>int</code>, then add.</p><pre>a, b = map(int, input().split())\nprint(a + b)</pre>',
  '<p><code>str.split()</code> breaks a string into a list. <code>int()</code> converts a string to an integer.</p>',
  'a, b = map(int, input().split())\n# Print a + b\n'),
 (4, '1', 'Count words', 'Easy', 10, 'Strings',
  '<p>Read one line and print how many words it has. Words are separated by spaces.</p>',
  '<p><code>split()</code> without arguments ignores repeated spaces.</p><pre>print(len(input().split()))</pre>',
  '<p><code>len()</code> returns the number of items in a list.</p>',
  'line = input()\n# Print the number of words\n'),
 (5, '1', 'Number guessing hint', 'Medium', 10, 'Conditions',
  '<p>The input has the secret number on the first line and the guess on the second line. Print <code>UP</code> if the guess is smaller, <code>DOWN</code> if it is larger, or <code>CORRECT</code> if equal.</p>',
  '<p>Compare the two numbers with <code>if / elif / else</code>.</p><pre>secret = int(input())\nguess = int(input())\nif guess < secret:\n    print("UP")\nelif guess > secret:\n    print("DOWN")\nelse:\n    print("CORRECT")</pre>',
  '<p><code>if</code>, <code>elif</code> and <code>else</code> choose one branch by condition.</p>',
  'secret = int(input())\nguess = int(input())\n# Print UP, DOWN or CORRECT\n');

INSERT INTO problem_cases (problem_id, ord, input_text, expected_output, is_sample) VALUES
 (1, 1, '', 'Hello, World!', 1),
 (2, 1, 'CodeML', 'CodeML', 1),
 (2, 2, 'a b  c', 'a b  c', 0),
 (3, 1, '1 2', '3', 1),
 (3, 2, '-5 5', '0', 0),
 (3, 3, '100000 200000', '300000', 0),
 (4, 1, 'learn python with codeml', '4', 1),
 (4, 2, 'one', '1', 0),
 (4, 3, 'a  b   c', '3', 0),
 (5, 1, '7\n3', 'DOWN', 1),
 (5, 2, '3\n7', 'UP', 0),
 (5, 3, '5\n5', 'CORRECT', 0);
