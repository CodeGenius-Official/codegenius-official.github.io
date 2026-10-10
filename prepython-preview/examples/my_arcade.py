def show_score(points):
    print("Score:", points)

game_name = "BEAT BOOST"
avatar = input("Fictional avatar: ")
multiplier = 3
score = 0
print(game_name)
print("Multiply each round number by", multiplier)
for round_number in range(1, 4):
    print("Round", round_number)
    answer_text = input("Your answer: ")
    answer = int(answer_text)
    correct = round_number * multiplier
    if answer == correct:
        score = score + 1
        print("Hit!")
    else:
        print("Try again next round")
    show_score(score)
print("Thanks", avatar)
