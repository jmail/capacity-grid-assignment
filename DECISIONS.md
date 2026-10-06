# Decisions

Yours to write, not your AI's. Short is good — bullets are fine, and half a page is
plenty. We read this first.

## What did the spec not tell you?

There are things this brief doesn't specify. Which ones did you hit, what did you decide,
and why?

- spec didnt get any hint what weekdays are counted into working week so I decided to count all days across whole week so it can fit any worksheet including L1 24/7 supports etc.
- it didnt mention what to do when to concurrent saves are happening - I decided to add additional error returned to UI when API tries to save value that was changed in meantime 
- I decided to start week on Mondays 
- I decided to show at most 26 weeks - for this amount of data it is fine. In full production mode it would require pagination etc what might not be doable in the given amount of time with proper testing.


## What did you notice that looked wrong?

Anything in the output that didn't match what you expected. Whether you fixed it or left
it, we want to know you saw it.

- names were sorted by bytes - fixed it with ICU collation
- api was logging cancelled requests as errors (fixed)
- 1/3 is overloaded - I left it as I do not know if that is real trouble or just data issue

## What did the AI get wrong that you caught?

One concrete example. Every real session has one.

- AI took the Mon–Fri stance, backing it up with scheduling statistics: no shift starts on a weekend, and a typical week worked out to exactly 40 hours. I rejected this based on domain knowledge: in retail and support, the weekend is just another workday.
- The "This week" button would retain the previously loaded time span; so, if I had 26 weeks loaded, it would load 26 weeks starting from today—whereas, in my opinion, if someone asks for the current week, they only want a single week.


## What would you do differently with a week?

- I’m rendering all the data today. Ideally, I’d implement pagination, but that would require setting up an API cursor, filters, a server-side counter for the total dataset, infinite loading, and row virtualization. It seems unfeasible given the time I have left.
- First of all, I would implement some form of entry history. Currently, it is impossible to change a person's capacity without altering the history; there should be a way to make the change effective from a specific date without overwriting past records. However, doing so would require changing the database schema, which is explicitly prohibited by the task requirements.
- Live updates across multiple open windows simultaneously. Currently, write protection is implemented in a simple way at the API level. Live data updates and propagation would be the better approach here.
