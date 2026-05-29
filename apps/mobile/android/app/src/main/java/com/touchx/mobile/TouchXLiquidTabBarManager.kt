package com.touchx.mobile

import android.graphics.Color
import android.os.Build
import android.view.HapticFeedbackConstants
import androidx.annotation.ColorInt
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color as ComposeColor
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.ViewCompositionStrategy
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.annotations.ReactProp
import com.facebook.react.uimanager.events.Event
import kotlin.math.roundToInt

class TouchXLiquidTabBarManager : SimpleViewManager<TouchXLiquidTabBarView>() {
  override fun getName(): String = REACT_CLASS

  override fun createViewInstance(reactContext: ThemedReactContext): TouchXLiquidTabBarView =
      TouchXLiquidTabBarView(reactContext)

  @ReactProp(name = "selectedIndex", defaultInt = 0)
  fun setSelectedIndex(view: TouchXLiquidTabBarView, selectedIndex: Int) {
    view.selectedIndex = selectedIndex
  }

  @ReactProp(name = "labels")
  fun setLabels(view: TouchXLiquidTabBarView, labels: ReadableArray?) {
    view.labels = labels?.toStringList().takeUnless { it.isNullOrEmpty() } ?: DEFAULT_LABELS
  }

  @ReactProp(name = "accentColor", customType = "Color")
  fun setAccentColor(view: TouchXLiquidTabBarView, @ColorInt color: Int?) {
    view.accentColor = color ?: DEFAULT_ACCENT
  }

  @ReactProp(name = "textColor", customType = "Color")
  fun setTextColor(view: TouchXLiquidTabBarView, @ColorInt color: Int?) {
    view.textColor = color ?: DEFAULT_TEXT
  }

  @ReactProp(name = "mutedColor", customType = "Color")
  fun setMutedColor(view: TouchXLiquidTabBarView, @ColorInt color: Int?) {
    view.mutedColor = color ?: DEFAULT_MUTED
  }

  @ReactProp(name = "surfaceColor", customType = "Color")
  fun setSurfaceColor(view: TouchXLiquidTabBarView, @ColorInt color: Int?) {
    view.surfaceColor = color ?: DEFAULT_SURFACE
  }

  override fun getExportedCustomDirectEventTypeConstants(): Map<String, Any> =
      mapOf(TabPressEvent.EVENT_NAME to mapOf("registrationName" to "onTabPress"))

  companion object {
    const val REACT_CLASS = "TouchXLiquidTabBar"
    private val DEFAULT_LABELS = listOf("今日", "日程表", "我的")
    private const val DEFAULT_ACCENT = 0xFF2F55C8.toInt()
    private const val DEFAULT_TEXT = 0xFF111111.toInt()
    private const val DEFAULT_MUTED = 0xFF6B6B70.toInt()
    private const val DEFAULT_SURFACE = 0xE6FFFFFF.toInt()
  }
}

class TouchXLiquidTabBarView(private val reactContext: ThemedReactContext) : ComposeView(reactContext) {
  var selectedIndex by mutableIntStateOf(0)
  var labels by mutableStateOf(listOf("今日", "日程表", "我的"))
  var accentColor by mutableIntStateOf(0xFF2F55C8.toInt())
  var textColor by mutableIntStateOf(0xFF111111.toInt())
  var mutedColor by mutableIntStateOf(0xFF6B6B70.toInt())
  var surfaceColor by mutableIntStateOf(0xE6FFFFFF.toInt())

  init {
    isClickable = true
    clipToOutline = false
    setBackgroundColor(Color.TRANSPARENT)
    setViewCompositionStrategy(ViewCompositionStrategy.DisposeOnDetachedFromWindow)
    setContent {
      TouchXLiquidTabBar(
          labels = labels,
          selectedIndex = selectedIndex.coerceIn(0, labels.lastIndex.coerceAtLeast(0)),
          accentColor = ComposeColor(accentColor),
          textColor = ComposeColor(textColor),
          mutedColor = ComposeColor(mutedColor),
          surfaceColor = ComposeColor(surfaceColor),
          onSelect = ::emitTabPress)
    }
  }

  private fun emitTabPress(index: Int) {
    if (index == selectedIndex) return
    performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
    UIManagerHelper.getEventDispatcherForReactTag(reactContext, id)
        ?.dispatchEvent(TabPressEvent(UIManagerHelper.getSurfaceId(reactContext), id, index))
  }
}

private class TabPressEvent(surfaceId: Int, viewId: Int, private val index: Int) :
    Event<TabPressEvent>(surfaceId, viewId) {
  override fun getEventName(): String = EVENT_NAME

  override fun getEventData() =
      Arguments.createMap().apply {
        putInt("target", viewTag)
        putInt("index", index)
      }

  companion object {
    const val EVENT_NAME = "topTabPress"
  }
}

@Composable
private fun TouchXLiquidTabBar(
    labels: List<String>,
    selectedIndex: Int,
    accentColor: ComposeColor,
    textColor: ComposeColor,
    mutedColor: ComposeColor,
    surfaceColor: ComposeColor,
    onSelect: (Int) -> Unit
) {
  val safeLabels = labels.takeIf { it.isNotEmpty() } ?: listOf("今日", "日程表", "我的")
  val tabCount = safeLabels.size
  val targetProgress = selectedIndex.coerceIn(0, tabCount - 1).toFloat()
  val progress by animateFloatAsState(
      targetValue = targetProgress,
      animationSpec = spring(dampingRatio = 0.76f, stiffness = 420f),
      label = "touchx-tab-progress")

  Box(
      modifier = Modifier
          .fillMaxSize()
          .padding(horizontal = 14.dp, vertical = 8.dp),
      contentAlignment = Alignment.Center) {
    LiquidGlassSurface(surfaceColor = surfaceColor, accentColor = accentColor)

    BoxWithIndicator(
        progress = progress,
        tabCount = tabCount,
        accentColor = accentColor,
        textColor = textColor,
        mutedColor = mutedColor,
        labels = safeLabels,
        selectedIndex = selectedIndex,
        onSelect = onSelect)
  }
}

@Composable
private fun LiquidGlassSurface(surfaceColor: ComposeColor, accentColor: ComposeColor) {
  val shape = RoundedCornerShape(30.dp)
  Box(
      Modifier
          .fillMaxWidth()
          .height(64.dp)
          .graphicsLayer {
            clip = true
            this.shape = shape
            shadowElevation = 18.dp.toPx()
            ambientShadowColor = ComposeColor.Black.copy(alpha = 0.16f)
            spotShadowColor = ComposeColor.Black.copy(alpha = 0.22f)
          }
          .background(surfaceColor, shape)
          .drawBehind {
            drawRoundRect(
                brush = Brush.linearGradient(
                    colors = listOf(
                        ComposeColor.White.copy(alpha = 0.82f),
                        ComposeColor.White.copy(alpha = 0.18f),
                        accentColor.copy(alpha = 0.10f)),
                    start = Offset.Zero,
                    end = Offset(size.width, size.height)),
                cornerRadius = androidx.compose.ui.geometry.CornerRadius(30.dp.toPx(), 30.dp.toPx()))
            drawRoundRect(
                color = ComposeColor.White.copy(alpha = 0.68f),
                cornerRadius = androidx.compose.ui.geometry.CornerRadius(30.dp.toPx(), 30.dp.toPx()),
                style = Stroke(width = 1.dp.toPx()))
            drawRoundRect(
                color = ComposeColor.Black.copy(alpha = 0.07f),
                topLeft = Offset(0f, size.height - 1.dp.toPx()),
                size = Size(size.width, 1.dp.toPx()),
                cornerRadius = androidx.compose.ui.geometry.CornerRadius(30.dp.toPx(), 30.dp.toPx()))
          })
}

@Composable
private fun BoxWithIndicator(
    progress: Float,
    tabCount: Int,
    accentColor: ComposeColor,
    textColor: ComposeColor,
    mutedColor: ComposeColor,
    labels: List<String>,
    selectedIndex: Int,
    onSelect: (Int) -> Unit
) {
  Box(Modifier.fillMaxWidth().height(64.dp)) {
    Box(
        modifier = Modifier
            .fillMaxWidth(1f / tabCount)
            .height(56.dp)
            .padding(horizontal = 4.dp)
            .offset {
              val width = size.width.toFloat()
              IntOffset((progress * width).roundToInt(), 0)
            }
            .graphicsLayer {
              scaleX = 1.02f
              scaleY = 1.02f
              shadowElevation = 8.dp.toPx()
              shape = RoundedCornerShape(26.dp)
              clip = true
              if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                renderEffect = null
              }
            }
            .background(ComposeColor.White.copy(alpha = 0.38f), RoundedCornerShape(26.dp))
            .drawBehind {
              drawRoundRect(
                  brush = Brush.radialGradient(
                      colors = listOf(
                          accentColor.copy(alpha = 0.28f),
                          ComposeColor.White.copy(alpha = 0.20f),
                          ComposeColor.Transparent),
                      center = Offset(size.width / 2f, size.height / 2f),
                      radius = size.maxDimension),
                  cornerRadius = androidx.compose.ui.geometry.CornerRadius(26.dp.toPx(), 26.dp.toPx()))
              drawRoundRect(
                  color = ComposeColor.White.copy(alpha = 0.80f),
                  cornerRadius = androidx.compose.ui.geometry.CornerRadius(26.dp.toPx(), 26.dp.toPx()),
                  style = Stroke(width = 0.8.dp.toPx()))
            })

    Row(
        modifier = Modifier.fillMaxSize().padding(horizontal = 4.dp),
        horizontalArrangement = Arrangement.SpaceEvenly,
        verticalAlignment = Alignment.CenterVertically) {
      labels.forEachIndexed { index, label ->
        LiquidTabItem(
            label = label,
            selected = selectedIndex == index,
            accentColor = accentColor,
            textColor = textColor,
            mutedColor = mutedColor,
            modifier = Modifier.weight(1f),
            onClick = { onSelect(index) })
      }
    }
  }
}

@Composable
private fun LiquidTabItem(
    label: String,
    selected: Boolean,
    accentColor: ComposeColor,
    textColor: ComposeColor,
    mutedColor: ComposeColor,
    modifier: Modifier = Modifier,
    onClick: () -> Unit
) {
  val interactionSource = androidx.compose.runtime.remember { MutableInteractionSource() }
  val pressed by interactionSource.collectIsPressedAsState()
  val scale by animateFloatAsState(
      targetValue = if (pressed) 0.92f else if (selected) 1.04f else 1f,
      animationSpec = spring(dampingRatio = 0.62f, stiffness = 520f),
      label = "touchx-tab-scale")
  val dotAlpha by animateFloatAsState(
      targetValue = if (selected) 1f else 0f,
      animationSpec = spring(dampingRatio = 0.8f, stiffness = 420f),
      label = "touchx-dot-alpha")

  Box(
      modifier = modifier
          .fillMaxSize()
          .scale(scale)
          .clip(RoundedCornerShape(24.dp))
          .clickable(
              interactionSource = interactionSource,
              indication = null,
              onClick = onClick),
      contentAlignment = Alignment.Center) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically) {
      LiquidIcon(selected = selected, color = if (selected) accentColor else mutedColor)
      androidx.compose.foundation.text.BasicText(
          text = label,
          style = TextStyle(
              color = if (selected) textColor else mutedColor,
              fontSize = 13.sp,
              fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium,
              textAlign = TextAlign.Center))
    }
    Box(
        modifier = Modifier
            .align(Alignment.BottomCenter)
            .padding(bottom = 7.dp)
            .size(width = 18.dp, height = 3.dp)
            .alpha(dotAlpha)
            .background(accentColor, CircleShape))
  }
}

@Composable
private fun LiquidIcon(selected: Boolean, color: ComposeColor) {
  val scale by animateFloatAsState(
      targetValue = if (selected) 1.08f else 1f,
      animationSpec = spring(dampingRatio = 0.7f, stiffness = 420f),
      label = "touchx-icon-scale")

  Canvas(modifier = Modifier.size(18.dp).scale(scale)) {
    val stroke = Stroke(width = 2.1.dp.toPx(), cap = androidx.compose.ui.graphics.StrokeCap.Round)
    val c = center
    if (selected) {
      drawCircle(color.copy(alpha = 0.16f), radius = size.minDimension / 2f)
      drawCircle(color, radius = size.minDimension * 0.27f)
      drawCircle(color.copy(alpha = 0.55f), radius = size.minDimension * 0.43f, style = stroke)
    } else {
      val path = Path().apply {
        moveTo(c.x, size.height * 0.18f)
        cubicTo(size.width * 0.84f, size.height * 0.26f, size.width * 0.84f, size.height * 0.74f, c.x, size.height * 0.82f)
        cubicTo(size.width * 0.16f, size.height * 0.74f, size.width * 0.16f, size.height * 0.26f, c.x, size.height * 0.18f)
      }
      drawPath(path, color.copy(alpha = 0.86f), style = stroke)
    }
  }
}

private fun ReadableArray.toStringList(): List<String> =
    List(size()) { index -> getString(index).orEmpty() }.filter { it.isNotBlank() }

