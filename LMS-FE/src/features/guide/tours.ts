/** Ellie's page tours. `target` = a [data-tour="…"] element to highlight; steps
 *  whose target isn't on screen are skipped, so tours adapt to what's there. */
export interface TourStep { target?: string; title: string; text: string }

export const TOURS: Record<string, TourStep[]> = {
  login: [
    { title: 'Hi, I’m Ellie!', text: 'I’ll walk you through Pariksha. You can skip me any time, or call me back with the elephant button.' },
    { target: 'login-role', title: 'Who are you today?', text: 'Students take tests. Professors create them and see the results. Pick one here.' },
    { target: 'login-form', title: 'Sign in', text: 'Students: type your roll number and name exactly as your professor has them. That’s all you need!' },
  ],
  'student-tests': [
    { title: 'Your tests live here', text: 'Every test your professor gives you shows up on this page.' },
    { target: 'test-card', title: 'A test card', text: 'It tells you how many questions and marks the test has. Press Start test when you’re ready.' },
    { target: 'tests-refresh', title: 'Not seeing a new test?', text: 'Press Refresh. Tests appear once your professor adds you to the roster.' },
  ],
  'test-intro': [
    { target: 'test-start', title: 'Before you begin', text: 'The test opens full-screen. Stay on this page — switching tabs is noticed! You’ll see your score and the answers only at the very end.' },
  ],
  'test-mcq': [
    { target: 'question-card', title: 'Read the question', text: 'Take your time. Read it twice if you need to.' },
    { target: 'answer-area', title: 'Drag your answer', text: 'Drag the right option into the box. You can also tap it, or press A, B, C or D.' },
    { target: 'submit-answer', title: 'Lock it in', text: 'Happy with your choice? Press Submit answer and the next question appears.' },
  ],
  'test-fill': [
    { target: 'answer-area', title: 'Fill in the blank', text: 'Type the missing word or words into the gap. Small spelling slips are OK!' },
  ],
  'test-match': [
    { target: 'answer-area', title: 'Match the pairs', text: 'Drag each card on the right onto the item on the left it belongs to. You can also tap a card, then tap where it goes.' },
  ],
  'student-result': [
    { target: 'result-score', title: 'You did it!', text: 'Here’s your score and grade for the whole test.' },
    { target: 'result-review', title: 'See every answer', text: 'Now you can see which answers were right, the correct answers, and why. Great for revising!' },
  ],
  'prof-content': [
    { title: 'Welcome, Professor!', text: 'I’ll show you how to go from a document to a finished test.' },
    { target: 'prof-nav', title: 'Your dashboard', text: 'Content → Events → Roster → Results. That’s the whole journey, left to right.' },
    { target: 'content-drop', title: 'Step 1: upload material', text: 'Drop a PDF or Word file here. I’ll build a knowledge graph from it — wait until it says Ready.' },
  ],
  'prof-events': [
    { target: 'event-form', title: 'Step 2: create a test', text: 'Give it a title and choose the content it’s based on.' },
    { target: 'question-types', title: 'Pick your question types', text: 'Choose how many MCQs, fill-in-the-blanks and match-the-following questions you want. I write them all at once.' },
    { target: 'create-test', title: 'Generate!', text: 'Press Create test. A progress bar shows each batch of questions as it’s written.' },
  ],
  'prof-roster': [
    { target: 'roster-drop', title: 'Step 3: add students', text: 'Upload a CSV with a roll_number column. Those students will see the test on their page.' },
  ],
  'prof-results': [
    { target: 'results-event', title: 'Step 4: see results', text: 'Pick a test to see every student’s status and marks.' },
    { target: 'results-table', title: 'Look closer', text: 'Click a student’s name to see each of their answers next to the correct one.' },
    { target: 'results-export', title: 'Take it with you', text: 'Export the marks to Excel whenever you need them.' },
  ],
}
