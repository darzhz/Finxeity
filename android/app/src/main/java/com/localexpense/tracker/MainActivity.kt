package com.localexpense.tracker

import android.os.Bundle
import com.getcapacitor.BridgeActivity
import com.localexpense.tracker.plugin.ExpensePlugin

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(ExpensePlugin::class.java)
        super.onCreate(savedInstanceState)
    }
}
