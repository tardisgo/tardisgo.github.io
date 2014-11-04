// rewrite for GopherJS by @elliottstoneham
// animation inspired by http://blog.golang.org/concurrency-is-not-parallelism
// gopher logo by Renée French

package main

import (
	"math/rand"
	"strings"

	"github.com/gopherjs/gopherjs/js"
)

func main() {
	Start()
}

// the globals below are inspected by the GopherJS interface code below to move and change sprites to create the animation
var bigpile, smallpile, oven chan int
var Sprite1X, Sprite1Y, Sprite2X, Sprite2Y float64
var Sprite1state, Sprite2state int

const ( // constants for the state of a gopher, also used by Haxe code
	Pick = iota
	Full
	Shovel
	Empty
)

// This function is called to set-off the gophers
func startGophers() {
	bigpile = make(chan int, 1)
	bigpile <- 1 // start low, so that left-hand gopher moves fast

	smallpile = make(chan int, 1)
	smallpile <- 10 // start high, so that right-hand gopher moves slow

	oven = make(chan int, 1)
	go fire() // burn everything that arrives!

	// now start off the two gophers
	go gopher(&Sprite1X, &Sprite1Y, &Sprite1state, bigpile, smallpile)
	go gopher(&Sprite2X, &Sprite2Y, &Sprite2state, smallpile, oven)
	go fillbigpile() // keep adding randomly to the big pile
}

func fillbigpile() {
	for {
		bigpile <- rand.Intn(9) + 1
		Gosched()
	}
}

func fire() {
	for {
		<-oven
		Gosched()
	}
}

// an individual gopher, animated with logos by the Haxe code
func gopher(x, y *float64, state *int, in, out chan int) {
	for {
		cartLoad := pickBooks(x, y, state, in)
		pushBooks(x, y, state, cartLoad)
		fireBooks(x, y, state, cartLoad, out)
		moreBooks(x, y, state)
	}
}

func pickBooks(x, y *float64, state *int, in chan int) int {
	*state = Pick
	*x = 0
	v := <-in
	loop(v) // spend longer picking some loads and putting them on the cart
	return v
}
func pushBooks(x, y *float64, state *int, cartLoad int) {
	*state = Full
	for *x = 0.0; *x < 150.0; (*x) += 10.0 / float64(cartLoad) {
		if *y > 0.0 { // create bumps in the road
			*y = 0.0
		} else {
			*y = float64(rand.Intn(3)) // random small bumps
		}
		Gosched() // without this, the animation would not show each state
	}
	if *x > 150.0 { // constrain large x offsets
		*x = 150.0
	}
	*y = 0.0
}
func fireBooks(x, y *float64, state *int, cartLoad int, out chan int) {
	*state = Shovel
	loop(cartLoad) // spend longer unloading some loads into the fire
	out <- cartLoad
}
func moreBooks(x, y *float64, state *int) {
	*state = Empty
	for *x > 0.0 {
		*x -= 10.0
		if *x < 0.0 { // no -ve x offsets please
			*x = 0.0
		}
		if *y > 0.0 { // create bumps in the road
			*y = 0.0
		} else {
			*y = float64(rand.Intn(5)) // random bigger bumps
		}
		Gosched() // would not show state without this, the animation would jump.
	}
	*y = 0.0
}
func loop(n int) { // add some delay when required
	n *= 1 // biger delay than in TARDIS Go
	for n > 0 {
		n--
		Gosched() // give up control in order to show the gopher waiting
	}
}

/**** JS interface code ****/

var headline, goTimer js.Object
var Books, Logo1, Logo2, Sprite1, Sprite2 *Sprite

const (
	s1x = 90
	s1y = 45
	s2x = 420
	s2y = 45
)

func makeText(selectable bool, x, y, width, height, textColor int, text string) js.Object {
	context.Set("font", "12px Arial")
	ss := strings.Split(text, "\n")
	for k, v := range ss {
		context.Call("fillText", v, x, y+(12*k))
	}
	return nil // Dummy
}

func makeBitmap(file string) js.Object {
	img := js.Global.Get("Image").New()
	img.Set("src", file)
	return img
}

type Sprite struct {
	bitmap js.Object
	x, y   int
}

func makeSprite(bitmap js.Object, x, y int) *Sprite {
	sp := &Sprite{
		bitmap: bitmap,
		x:      x,
		y:      y,
	}
	bitmap.Call("addEventListener", "load", func() {
		context.Call("drawImage", bitmap, x, y)
		sp.bitmap = bitmap
		sp.x = x
		sp.y = y
	}, false)
	return sp
}

var emptyPilePng, smallPilePng, pickPng1, pickPng2, fullPng1, fullPng2, emptyPng1, emptyPng2, shovelPng1, shovelPng2, white, L1, L2, WT js.Object

var context js.Object

func Start() {
	doc := js.Global.Get("document")
	canvas := doc.Call("getElementById", "myCanvas")
	context = canvas.Call("getContext", "2d")

	// setup the animated PNG bitmaps
	emptyPilePng = makeBitmap("assets/emptypile.png")
	smallPilePng = makeBitmap("assets/smallpile.png")
	pickPng1 = makeBitmap("assets/pick.png")
	pickPng2 = makeBitmap("assets/pick.png")
	fullPng1 = makeBitmap("assets/full.png")
	fullPng2 = makeBitmap("assets/full.png")
	emptyPng1 = makeBitmap("assets/empty.png")
	emptyPng2 = makeBitmap("assets/empty.png")
	shovelPng1 = makeBitmap("assets/shovel.png")
	shovelPng2 = makeBitmap("assets/shovel.png")
	white = makeBitmap("assets/white.png")
	WT = makeBitmap("assets/whitethumb.png")

	// headline at the top
	headline = makeText(false, 200, 10, 500, 50, 0x008000, "")

	// Explation text on the left
	makeText(false, 10, 140, 180, 200, 0x008000, `Both animated gophers are 
running the code on the right.
The 2 logos show where they
each are in that code now.
Go translated to JS using
GopherJS.`)

	// the code extract in the centre
	makeSprite(makeBitmap("assets/function.png"), 200, 110)

	// the "inspired by"" text
	makeText(true, 630, 140, 200, 200, 0x008000, `Inspired by Rob Pike:
"Concurrency is not Parallelism"
http://blog.golang.org/
concurrency-is-not-parallelism

- Gopher by Renee French`)

	// big pile of books on the left
	makeSprite(makeBitmap("assets/bigpile.png"), 10, 20)

	// oven on the right
	makeSprite(makeBitmap("assets/oven.png"), 690, 0)

	// books in the middle
	Books = makeSprite(emptyPilePng, 390, 50)

	// the left hand code indicator
	L1 = makeBitmap("assets/gophercolor16x16.png")
	Logo1 = makeSprite(L1, 230, 140)

	// the right hand code indicator
	L2 = makeBitmap("assets/gophercolor16x16flipped.png")
	Logo2 = makeSprite(L2, 540, 140)

	// the left hand gopher
	Sprite1 = makeSprite(pickPng1, s1x, s1y)

	// the right hand gopher
	Sprite2 = makeSprite(pickPng2, s2x, s2y)

	RAF()          // show the picture before we start moving
	startGophers() // start the animation logic

	for { // this to ensure that the main function does not finish
		Gosched()
	}
}

func replaceBitmap(sprite *Sprite, bitmap *js.Object) { // pointers here to avoid a Haxe object copy when passing by value

	sprite.bitmap = *bitmap
	context.Call("drawImage", sprite.bitmap, sprite.x, sprite.y)
	RAF()

}

var showingBooks bool = true

var s1state, s2state int = Pick, Pick

func monitor() {
	RAF()

	// make the pile of books appear or disappear
	if len(smallpile) > 0 { // take the length of the channel here
		if !showingBooks {
			replaceBitmap(Books, &smallPilePng)
			showingBooks = true
		}
	} else {
		if showingBooks {
			replaceBitmap(Books, &emptyPilePng)
			showingBooks = false
		}
	}

	// animate left-hand sprite and it's code logo
	newY1 := 140 + (15 * Sprite1state) // move the logo to reflect the new state
	if Logo1.y != newY1 {
		replaceBitmap(Logo1, &WT)
		Logo1.y = newY1
		replaceBitmap(Logo1, &L1)
	}
	if s1state != Sprite1state {
		switch s1state {
		case Shovel, Pick:
			replaceBitmap(Sprite1, &white)
		}
		s1state = Sprite1state
	}
	newS1X := int(s1x + Sprite1X)
	newS1Y := int(s1y + Sprite1Y)
	if Sprite1.x != newS1X || Sprite1.y != newS1Y {
		Sprite1.x = newS1X
		Sprite1.y = newS1Y
		switch Sprite1state {
		case Pick:
			replaceBitmap(Sprite1, &pickPng1)
		case Full:
			replaceBitmap(Sprite1, &fullPng1)
		case Shovel:
			replaceBitmap(Sprite1, &shovelPng1)
		case Empty:
			replaceBitmap(Sprite1, &emptyPng1)
		}
	}

	// animate right-hand sprite and it's code logo
	newY2 := 140 + (15 * Sprite2state) // move the logo to reflect the new state
	if Logo2.y != newY2 {
		replaceBitmap(Logo2, &WT)
		Logo2.y = newY2
		replaceBitmap(Logo2, &L2)
	}
	if s2state != Sprite2state {
		switch s2state {
		case Shovel, Pick:
			replaceBitmap(Sprite2, &white)
		}
		s2state = Sprite2state
	}
	newS2X := int(s2x + Sprite2X)
	newS2Y := int(s2y + Sprite2Y)
	if Sprite2.x != newS2X || Sprite2.y != newS2Y {
		Sprite2.x = newS2X
		Sprite2.y = newS2Y
		switch Sprite2state {
		case Pick:
			replaceBitmap(Sprite2, &pickPng2)
		case Full:
			replaceBitmap(Sprite2, &fullPng2)
		case Shovel:
			replaceBitmap(Sprite2, &shovelPng2)
		case Empty:
			replaceBitmap(Sprite2, &emptyPng2)
		}
	}
}

var gosched_chan = make(chan bool, 1)
var gosched_full bool

// Gosched schedules other goroutines.
func Gosched() {
	monitor()
	if gosched_full {
		gosched_full = false
		gosched_chan <- true
	} else {
		gosched_full = true
		<-gosched_chan
	}
}

var RAF_chan = make(chan bool, 1)

func RAF_callback() {
	go func() { RAF_chan <- true }()
}

// RAF - Request Animation Frame
func RAF() {
	js.Global.Get("window").Call("requestAnimationFrame", RAF_callback)
	<-RAF_chan
}
