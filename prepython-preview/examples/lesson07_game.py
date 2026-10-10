def show_score(points):
    print("Score:", points)

score = 0
for round_number in range(1, 4):
    print("Round", round_number)
    answer_text = input("Round number x 2 = ")
    answer = int(answer_text)
    correct = round_number * 2
    if answer == correct:
        score = score + 1
        print("Hit!")
    else:
        print("Try again next round")
    show_score(score)
print("Game over")
